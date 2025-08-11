const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Company = require('../models/Company');
const Notification = require('../models/Notification');
const VisitPlan = require('../models/VisitPlan');
const User = require('../models/User')
const DailyReport = require('../models/DailyReport');
const CustomerAssignment = require('../models/CustomerAssignment');
const calculateVisitStats = require('../utils/visitStats');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const getAdmins = async (companyId, excludeUserId = null) => {
  let query = { companyId, role: 'admin' };
  let admins = await User.find(query, '_id');

  let adminIds = admins.map(admin => admin._id.toString());

  if (excludeUserId) {
    adminIds = adminIds.filter(id => id !== excludeUserId.toString());
  }

  return adminIds;
};

const getRankWeight = (rank) => {
  const weights = {
    'A+': 1,
    'A': 2,
    'B+': 3,
    'B': 4,
    'C+': 5,
    'C': 6,
    'D+': 7,
    'D': 8,
    'F': 9,
  };
  return weights[rank] || 99;
};

const validateCustomerCode = (code) => {
  if (!code) return { valid: true };
  
  const cleanedCode = code.trim().toUpperCase();
  
  if (!/^[A-Z0-9\-]+$/.test(cleanedCode)) {
    return { 
      valid: false,
      message: '❌ كود العميل يجب أن يحتوي على أحرف كابيتال، أرقام وشرطة فقط'
    };
  }
  
  if (cleanedCode.length < 3 || cleanedCode.length > 20) {
    return {
      valid: false,
      message: '❌ كود العميل يجب أن يكون بين 3 و20 حرفًا'
    };
  }
  
  return { valid: true, cleanedCode };
};

const removeCustomerFromAllVisitPlans = async (customerId, companyId) => {
  try {
    // Find ALL visit plans in the company
    const visitPlans = await VisitPlan.find({ companyId });

    // Process each plan
    for (const plan of visitPlans) {
      let needsUpdate = false;
      
      // Check each day in the plan
      plan.days = plan.days.map(day => {
        const originalCount = day.customers.length;
        day.customers = day.customers.filter(
          cust => cust.customerId.toString() !== customerId.toString()
        );
        
        if (day.customers.length !== originalCount) {
          needsUpdate = true;
        }
        return day;
      });

      // Save only if changes were made
      if (needsUpdate) {
        await plan.save();
      }
    }
  } catch (error) {
    console.error('Failed to clean visit plans:', error);
    throw error;
  }
};


const createCustomer = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({ message: '❌ الشركة المرتبطة بالعميل غير موجودة' });
    }

    const customerData = { ...req.body, companyId };

    // Handle customer_code validation and formatting
    if (req.body.customer_code) {
      const codeValidation = validateCustomerCode(req.body.customer_code);
      if (!codeValidation.valid) {
        return res.status(400).json({ message: codeValidation.message });
      }
      customerData.customer_code = codeValidation.cleanedCode;
    } else {
      customerData.customer_code = undefined;
    }

    // Handle rank
    if (req.body.rank && req.body.rank.trim() !== '') {
      customerData.rank = req.body.rank;
      customerData.rankWeight = getRankWeight(req.body.rank);
    } else {
      customerData.rank = null;
      customerData.rankWeight = null;
    }

    // Handle managerName (optional)
    if (req.body.managerName && req.body.managerName.trim() !== '') {
      customerData.managerName = req.body.managerName.trim();
    } else {
      customerData.managerName = undefined;
    }

    const newCustomer = new Customer(customerData);
    const savedCustomer = await newCustomer.save();

    // --- Handle sales rep assignments ---
    let repIds = [];

    if (customerData.isPublic) {
      repIds = [];
    } else {
      if (req.user.role === 'rep' || req.user.role === 'sales') {
        repIds = [req.user.userId];
      } else if (req.user.role === 'admin') {
        if (Array.isArray(req.body.repIds) && req.body.repIds.length > 0) {
          repIds = req.body.repIds;
        }
      }
    }

    if (repIds.length > 0) {
      const validReps = await User.find({
        _id: { $in: repIds },
        companyId,
        role: { $in: ['rep', 'sales'] }
      }).select('_id username companyId role').lean();

      const validRepIds = validReps.map(r => r._id.toString());
      const invalidRepIds = repIds.filter(id => !validRepIds.includes(id.toString()));

      if (invalidRepIds.length > 0) {
        return res.status(400).json({
          message: `❌ هؤلاء المندوبين غير موجودين أو لا ينتمون لشركتك: ${invalidRepIds.join(', ')}`
        });
      }

      const assignments = validRepIds.map(repId => ({
        customerId: savedCustomer._id,
        repId,
        assignedBy: req.user.userId,
      }));

      if (assignments.length > 0) {
        await CustomerAssignment.insertMany(assignments, { ordered: false }).catch(err => {
          if (err.code !== 11000) throw err;
        });

        // Add customer to visit plans of assigned reps with all required fields
        for (const repId of validRepIds) {
          let plan = await VisitPlan.findOne({ repId, companyId });
          if (!plan) {
            plan = new VisitPlan({
              repId,
              companyId,
              days: Array(7).fill().map(() => ({ customers: [] }))
            });
          }

         
        }
      }
    }

    // Create notification
    const adminIds = await getAdmins(req.user.companyId, req.user.userId);

    Notification.create({
      userId: req.user.userId,
      targetUsers: adminIds,
      actionType: 'add_customer',
      description: `المستخدم ${req.user.username} أضاف العميل ${savedCustomer.fullName}`,
      relatedEntity: {
        entityType: 'Customer',
        entityId: savedCustomer._id
      }
    }).catch(err => {
      console.error('Failed to create notification:', err);
    });

    res.status(201).json(savedCustomer);

  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern.customer_code) {
        return res.status(400).json({ message: '❌ كود العميل هذا مستخدم مسبقًا' });
      }
      return res.status(400).json({ message: '❌ العميل موجود مسبقًا' });
    }
    console.error('Error creating customer:', err);
    res.status(400).json({ 
      message: '❌ فشل في إنشاء العميل', 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(401).json({ message: '❌ لا يوجد تعريف للشركة في التوكن (Unauthorized).' });
    }

    let { fullName, city, isActive, page, limit, sort, order, rank, repId, customerCode } = req.query;
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = { companyId: new mongoose.Types.ObjectId(companyId) };
    
    if (fullName && fullName.trim() !== '') {
      const safeFullName = escapeRegex(fullName.trim());
      query.fullName = { $regex: safeFullName, $options: 'i' };
    }
    
    if (city && city.trim() !== '') {
      query.city = city.trim();
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    if (rank && rank.trim() !== '') {
      query.rank = rank.trim();
    }
    
    if (customerCode && customerCode.trim() !== '') {
      const safeCustomerCode = escapeRegex(customerCode.trim().toUpperCase());
      query.customer_code = { $regex: safeCustomerCode, $options: 'i' };
    }

    const pageNumber = page ? Number(page) : 1;
    const limitNumber = limit ? Math.min(Number(limit), 50) : 10;
    const skip = (pageNumber - 1) * limitNumber;

    // Sort options
    const sortOptions = {};
    const allowedSortFields = ['fullName', 'city', 'isActive', 'rank', 'customer_code'];
    const allowedOrders = ['asc', 'desc'];

    if (sort && allowedSortFields.includes(sort)) {
      sortOptions[sort === 'rank' ? 'rankWeight' : sort] = order === 'desc' ? -1 : 1;
    } else {
      sortOptions.fullName = 1;
    }

    // Handle rep filter for admin
    if (req.user.role === 'admin' && repId) {
      const repObjectId = new mongoose.Types.ObjectId(repId);
      
      const pipeline = [
        {
          $match: query
        },
        {
          $lookup: {
            from: 'customerassignments',
            localField: '_id',
            foreignField: 'customerId',
            as: 'assignments'
          }
        },
        {
          $match: {
            $or: [
              { isPublic: true },
              { assignments: { $elemMatch: { repId: repObjectId } } }
            ]
          }
        },
        { $sort: sortOptions },
        { $skip: skip },
        { $limit: limitNumber }
      ];

      const totalCountPipeline = [
        { $match: query },
        {
          $lookup: {
            from: 'customerassignments',
            localField: '_id',
            foreignField: 'customerId',
            as: 'assignments'
          }
        },
        {
          $match: {
            $or: [
              { isPublic: true },
              { assignments: { $elemMatch: { repId: repObjectId } } }
            ]
          }
        },
        { $count: 'total' }
      ];

      const totalCustomersArr = await Customer.aggregate(totalCountPipeline);
      const totalCustomers = totalCustomersArr.length > 0 ? totalCustomersArr[0].total : 0;
      const totalPages = Math.max(1, Math.ceil(totalCustomers / limitNumber));
      const currentPage = Math.min(pageNumber, totalPages);

      const customers = await Customer.aggregate(pipeline);

      return res.status(200).json({ customers, totalCustomers, totalPages, currentPage });
    }
    // Handle rep/sales user view
    else if (req.user.role === 'rep' || req.user.role === 'sales') {
      const userId = new mongoose.Types.ObjectId(req.user.userId);

      const pipeline = [
        {
          $match: query
        },
        {
          $lookup: {
            from: 'customerassignments',
            localField: '_id',
            foreignField: 'customerId',
            as: 'assignments'
          }
        },
        {
          $match: {
            $or: [
              { isPublic: true },
              { assignments: { $elemMatch: { repId: userId } } }
            ]
          }
        },
        { $sort: sortOptions },
        { $skip: skip },
        { $limit: limitNumber }
      ];

      const totalCountPipeline = [
        { $match: query },
        {
          $lookup: {
            from: 'customerassignments',
            localField: '_id',
            foreignField: 'customerId',
            as: 'assignments'
          }
        },
        {
          $match: {
            $or: [
              { isPublic: true },
              { assignments: { $elemMatch: { repId: userId } } }
            ]
          }
        },
        { $count: 'total' }
      ];

      const totalCustomersArr = await Customer.aggregate(totalCountPipeline);
      const totalCustomers = totalCustomersArr.length > 0 ? totalCustomersArr[0].total : 0;
      const totalPages = Math.max(1, Math.ceil(totalCustomers / limitNumber));
      const currentPage = Math.min(pageNumber, totalPages);

      const customers = await Customer.aggregate(pipeline);

      return res.status(200).json({ customers, totalCustomers, totalPages, currentPage });
    }
    // Admin view (all customers or filtered by other criteria)
    else {
      const totalCustomers = await Customer.countDocuments(query);
      const totalPages = Math.max(1, Math.ceil(totalCustomers / limitNumber));
      const currentPage = Math.min(pageNumber, totalPages);

      const customers = await Customer.find(query)
        .collation({ locale: 'ar', strength: 2 })
        .skip(skip)
        .limit(limitNumber)
        .sort(sortOptions);

      return res.status(200).json({ customers, totalCustomers, totalPages, currentPage });
    }
  } catch (error) {
    console.error('💥 Error in getAllCustomers:', error);
    res.status(500).json({ 
      message: '❌ خطأ داخلي في السيرفر عند جلب العملاء', 
      error: error.message 
    });
  }
};

const getCustomerAssignments = async (req, res) => {
  const { customerId } = req.query;
  
  if (!isValidId(customerId)) {
    return res.status(400).json({ message: '❌ معرف العميل غير صالح' });
  }

  try {
    const companyId = req.user.companyId;

    const customer = await Customer.findOne({ _id: customerId, companyId });
    if (!customer) {
      return res.status(404).json({ message: '❌ العميل غير موجود أو ليس ضمن شركتك' });
    }

    const assignments = await CustomerAssignment.find({ customerId })
      .populate('repId', 'fullName username')
      .populate('assignedBy', 'fullName username')
      .lean();

    res.json({
      isPublic: customer.isPublic,
      assignments: assignments.map(a => ({
        _id: a._id,
        repId: a.repId?._id,
        repName: a.repId?.fullName,
        repUsername: a.repId?.username,
        assignedById: a.assignedBy?._id,
        assignedByName: a.assignedBy?.fullName,
        assignedAt: a.createdAt
      }))
    });

  } catch (error) {
    console.error('Error getting assignments:', error);
    res.status(500).json({ 
      message: '❌ فشل في جلب بيانات التعيينات',
      error: error.message 
    });
  }
};

const getCustomerStats = async (req, res) => {
  const { companyId, role, userId } = req.user;
  
  try {
    // Base query for all users
    let query = {
      companyId: new mongoose.Types.ObjectId(companyId),
      isActive: true
    };

    // For sales reps, add assignment filter
    if (role === 'rep' || role === 'sales') {
      // First get all customer IDs that belong to this company
      const companyCustomerIds = await Customer.find({ companyId }).distinct('_id');
      
      // Then find assignments for this rep only for company customers
      const assignedCustomerIds = await CustomerAssignment.distinct('customerId', {
        repId: userId,
        customerId: { $in: companyCustomerIds }
      });

      query = {
        $and: [
          query,
          {
            $or: [
              { isPublic: true },
              { _id: { $in: assignedCustomerIds } }
            ]
          }
        ]
      };
    }

    // Get total active customers
    const totalActiveCustomers = await Customer.countDocuments(query);

    // Get unique cities
    const cities = await Customer.distinct('city', query);

    // Get top city
    const topCityResult = await Customer.aggregate([
      { $match: query },
      { $group: { _id: "$city", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);

    const stats = {
      totalActiveCustomers,
      uniqueCities: cities.length,
      topCity: topCityResult[0]?._id || null,
      topCityCount: topCityResult[0]?.count || 0,
      avgCustomersPerCity: cities.length > 0 
        ? Math.round(totalActiveCustomers / cities.length) 
        : 0
    };

    res.json(stats);

  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ 
      success: false,
      message: "Error fetching stats",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


const updateCustomer = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ message: '❌ معرف العميل غير صالح' });
  }

  try {
    const companyId = req.user.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({ message: '❌ الشركة المرتبطة بالعميل غير موجودة' });
    }

    // Get the customer before updating
    const oldCustomer = await Customer.findById(id);
    if (!oldCustomer) {
      return res.status(404).json({ message: '❌ العميل غير موجود' });
    }

    // Handle customer_code
    if (req.body.customer_code !== undefined) {
      const codeValidation = validateCustomerCode(req.body.customer_code);
      if (!codeValidation.valid) {
        return res.status(400).json({ message: codeValidation.message });
      }
      req.body.customer_code = codeValidation.cleanedCode || undefined;
    }

    // Calculate rank weight if rank is provided
    if (req.body.rank && req.body.rank.trim() !== '') {
      req.body.rankWeight = getRankWeight(req.body.rank);
    } else if (req.body.rank === '') {
      req.body.rank = null;
      req.body.rankWeight = null;
    }

    // Handle managerName (optional)
    if (req.body.managerName !== undefined) {
      if (req.body.managerName.trim() !== '') {
        req.body.managerName = req.body.managerName.trim();
      } else {
        req.body.managerName = undefined;
      }
    }

    // Handle sales rep assignments
    let repIds = [];
    let isPublic = req.body.isPublic || false;

    // Get all current assignments before making any changes
    const oldAssignments = await CustomerAssignment.find({ customerId: id });
    const oldRepIds = oldAssignments.map(a => a.repId.toString());

    if (isPublic) {
      // If customer is public, clear all assignments but DON'T remove from visit plans
      repIds = [];
      await CustomerAssignment.deleteMany({ customerId: id });
    } else {
      if (req.user.role === 'rep' || req.user.role === 'sales') {
        // Sales rep can only assign to themselves
        repIds = [req.user.userId];
      } else if (req.user.role === 'admin') {
        // Admin can assign multiple reps
        if (Array.isArray(req.body.repIds) && req.body.repIds.length > 0) {
          repIds = req.body.repIds;
        }
      }

      // Validate the sales reps
      if (repIds.length > 0) {
        const validReps = await User.find({
          _id: { $in: repIds },
          companyId,
          role: { $in: ['rep', 'sales'] }
        }).select('_id username companyId role').lean();

        const validRepIds = validReps.map(r => r._id.toString());
        const invalidRepIds = repIds.filter(id => !validRepIds.includes(id.toString()));

        if (invalidRepIds.length > 0) {
          return res.status(400).json({
            message: `❌ هؤلاء المندوبين غير موجودين أو لا ينتمون لشركتك: ${invalidRepIds.join(', ')}`
          });
        }

        // Update assignments
        await CustomerAssignment.deleteMany({ customerId: id });
        
        const assignments = validRepIds.map(repId => ({
          customerId: id,
          repId,
          assignedBy: req.user.userId,
        }));

        if (assignments.length > 0) {
          await CustomerAssignment.insertMany(assignments, { ordered: false }).catch(err => {
            if (err.code !== 11000) throw err;
          });
        }

        // FIRST: Remove customer from ALL visit plans of previously assigned reps
        for (const repId of oldRepIds) {
          const plan = await VisitPlan.findOne({ repId, companyId });
          if (plan) {
            let needsUpdate = false;
            plan.days = plan.days.map(day => {
              const originalLength = day.customers.length;
              day.customers = day.customers.filter(
                cust => cust.customerId.toString() !== id.toString()
              );
              if (day.customers.length !== originalLength) {
                needsUpdate = true;
              }
              return day;
            });
            if (needsUpdate) await plan.save();
          }
        }

        // THEN: Add customer to visit plans of newly assigned reps with updated info
        const updatedCustomerData = {
          ...req.body,
          isPublic
        };
        
        for (const repId of validRepIds) {
          let plan = await VisitPlan.findOne({ repId, companyId });
          if (!plan) {
            // Create new plan if doesn't exist
            plan = new VisitPlan({
              repId,
              companyId,
              days: Array(7).fill().map(() => ({ customers: [] }))
            });
          }

          // Check if customer already exists in any day
          const customerExists = plan.days.some(day => 
            day.customers.some(c => c.customerId.toString() === id.toString())
          );

          if (!customerExists) {
            // Add to first day by default with all required fields
            plan.days[0].customers.push({
              customerId: id,
              fullName: updatedCustomerData.fullName || oldCustomer.fullName,
              customer_code: updatedCustomerData.customer_code || oldCustomer.customer_code,
              visitOrder: plan.days[0].customers.length + 1
            });
            await plan.save();
          } else {
            // Update existing customer info in visit plans
            plan.days = plan.days.map(day => {
              day.customers = day.customers.map(customer => {
                if (customer.customerId.toString() === id.toString()) {
                  return {
                    ...customer,
                    fullName: updatedCustomerData.fullName || customer.fullName,
                    customer_code: updatedCustomerData.customer_code || customer.customer_code
                  };
                }
                return customer;
              });
              return day;
            });
            await plan.save();
          }
        }
      } else {
        // No reps assigned and not public - remove all assignments and from all visit plans
        await CustomerAssignment.deleteMany({ customerId: id });
        await removeCustomerFromAllVisitPlans(id, companyId);
        isPublic = false;
      }
    }

    // Update the customer
    const updateData = {
      ...req.body,
      isPublic
    };

    const updatedCustomer = await Customer.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    // Calculate changed fields for notification
    const changedFields = {};
    for (const key of Object.keys(req.body)) {
      if (['updatedAt', 'createdAt', '__v', 'rankWeight'].includes(key)) continue;

      const newVal = req.body[key];
      const oldVal = oldCustomer[key];

      if (newVal?.toString() !== oldVal?.toString()) {
        changedFields[key] = newVal;
      }
    }

    // Add assignment changes to notification
    const oldIsPublic = oldCustomer.isPublic || false;
    
    if (isPublic !== oldIsPublic) {
      changedFields.isPublic = isPublic;
    }

    if (!isPublic && JSON.stringify(repIds.sort()) !== JSON.stringify(oldRepIds.sort())) {
      changedFields.repIds = repIds;
    }

    // Create notification if there are changes
    if (Object.keys(changedFields).length > 0) {
      const adminIds = await getAdmins(req.user.companyId, req.user.userId);

      await Notification.create({
        userId: req.user.userId,
        targetUsers: adminIds,
        actionType: 'edit_customer',
        description: `المستخدم ${req.user.username} حدّث العميل ${oldCustomer.fullName}`,
        changes: changedFields,
        relatedEntity: {
          entityType: 'Customer',
          entityId: id,
        }
      }).catch(err => {
        console.error('Failed to create notification:', err);
      });
    }

    res.json(updatedCustomer);
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern.customer_code) {
        return res.status(400).json({ message: '❌ كود العميل هذا مستخدم مسبقًا' });
      }
      return res.status(400).json({ message: '❌ العميل موجود مسبقًا' });
    }
    console.error('Update customer error:', err);
    res.status(400).json({ 
      message: '❌ فشل في تحديث بيانات العميل', 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// 🔍 جلب عميل بالـ ID
// 🔍 جلب عميل بالـ ID
const getCustomerById = async (req, res) => {
  const { id } = req.params;
  
  // التحقق من صحة المعرف
  if (!isValidId(id)) {
    return res.status(400).json({ 
      success: false,
      message: '❌ معرف العميل غير صالح',
      error: 'INVALID_CUSTOMER_ID'
    });
  }

  try {
    const companyId = req.user.companyId;
    
    // البحث عن العميل مع تضمين معلومات إضافية إذا لزم الأمر
    const customer = await Customer.findOne({ _id: id, companyId })
      .select('-__v -createdAt -updatedAt') // استثناء الحقول غير الضرورية
      .lean();

    if (!customer) {
      return res.status(404).json({ 
        success: false,
        message: '❌ العميل غير موجود أو ليس ضمن شركتك',
        error: 'CUSTOMER_NOT_FOUND'
      });
    }

    // إضافة معلومات إضافية إذا لزم الأمر
    const result = {
      ...customer,
      // يمكن إضافة حقول محسوبة هنا إذا needed
      isActive: customer.isActive || false, // قيمة افتراضية
      customer_code: customer.customer_code || 'غير محدد' // قيمة افتراضية
    };

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (err) {
    console.error('Error fetching customer:', err);
    
    // معالجة أخطاء محددة
    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: '❌ معرف العميل غير صالح',
        error: 'INVALID_ID_FORMAT'
      });
    }

    res.status(500).json({
      success: false,
      message: '❌ فشل في جلب بيانات العميل',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      errorCode: 'FETCH_CUSTOMER_ERROR'
    });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyId, userId, username } = req.user;

    // 1. Get customer data before deletion
    const customerToDelete = await Customer.findOne({ _id: id, companyId }).lean();
    if (!customerToDelete) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const adminIds = await getAdmins(req.user.companyId, req.user.userId);

    // 2. Create deletion notification
    Notification.create({
      userId: userId,
      level: "warning",
      targetUsers: adminIds,
      actionType: 'delete_customer',
      description: `المستخدم ${username} حذف العميل ${customerToDelete.fullName}`,
      relatedEntity: {
        entityType: 'Customer',
        entityId: customerToDelete._id
      },
      previousData: customerToDelete
    }).catch(err => {
      console.error('Failed to create notification:', err);
    });

    // 3. Remove from ALL visit plans
    await removeCustomerFromAllVisitPlans(id, companyId);

    // 4. Process reports in batches
    const BATCH_SIZE = 100;
    let reportsProcessed = 0;
    let batchCount = 0;
    let lastProcessedId = null;

    do {
      const reportsBatch = await DailyReport.find(
        { 
          companyId, 
          'visits.customerId': id,
          ...(batchCount > 0 ? { _id: { $gt: lastProcessedId } } : {})
        },
        { _id: 1, visits: 1 },
        { sort: { _id: 1 }, limit: BATCH_SIZE }
      ).lean();

      if (reportsBatch.length === 0) break;

      const bulkOps = reportsBatch.map(report => {
        const updatedVisits = report.visits.filter(v => v.customerId.toString() !== id);
        if (updatedVisits.length === 0) {
          return {
            deleteOne: { filter: { _id: report._id } }
          };
        } else {
          return {
            updateOne: {
              filter: { _id: report._id },
              update: {
                $set: {
                  visits: updatedVisits,
                  stats: calculateVisitStats(updatedVisits)
                }
              }
            }
          };
        }
      });

      await DailyReport.bulkWrite(bulkOps);
      reportsProcessed += reportsBatch.length;
      batchCount++;
      lastProcessedId = reportsBatch[reportsBatch.length - 1]._id;
    } while (true);

    // 5. Delete customer
    const deleteResult = await Customer.deleteOne({ _id: id, companyId });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        message: 'Customer fully deleted',
        reportsCleaned: reportsProcessed
      }
    });

  } catch (error) {
    console.error('[DELETE ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Deletion failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerStats,
  getCustomerAssignments
};
