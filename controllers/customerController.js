const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Company = require('../models/Company');
const Notification = require('../models/Notification');
const VisitPlan = require('../models/VisitPlan');
const User = require('../models/User')
const DailyReport = require('../models/DailyReport');
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

const createCustomer = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({ message: '❌ الشركة المرتبطة بالعميل غير موجودة' });
    }

    // إعداد بيانات العميل
    const customerData = { ...req.body, companyId };
    if (req.body.rank && req.body.rank.trim() !== '') {
      customerData.rank = req.body.rank;
      customerData.rankWeight = getRankWeight(req.body.rank);
    } else {
      customerData.rank = null;
      customerData.rankWeight = null;
    }

    const newCustomer = new Customer(customerData);
    const savedCustomer = await newCustomer.save();

    // جلب الأدمنات في الشركة

    const adminIds = await getAdmins(req.user.companyId, req.user.userId);

    // إنشاء الإشعار لكل الأدمنات
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
      return res.status(400).json({ message: '❌ العميل موجود مسبقًا' });
    }
    console.log(err.message);
    res.status(400).json({ message: '❌ فشل في إنشاء العميل', error: err.message });
  }
};

const getCustomerStats = async (req, res) => {
  const { companyId } = req.user;
  
  try {
    // Single optimized aggregation
    const stats = await Customer.aggregate([
      {
        $match: { 
          companyId: new mongoose.Types.ObjectId(companyId),
          isActive: true 
        }
      },
      {
        $facet: {
          // Pipeline 1: Get total and city distribution
          totals: [
            { 
              $group: { 
                _id: null,
                totalActiveCustomers: { $sum: 1 },
                cities: { $addToSet: "$city" }
              } 
            }
          ],
          // Pipeline 2: Get top city in parallel
          topCity: [
            { 
              $group: { 
                _id: "$city", 
                count: { $sum: 1 } 
              } 
            },
            { $sort: { count: -1 } },
            { $limit: 1 }
          ]
        }
      },
      {
        $project: {
          totalActiveCustomers: { 
            $ifNull: [{ $arrayElemAt: ["$totals.totalActiveCustomers", 0] }, 0] 
          },
          uniqueCities: { 
            $size: { 
              $ifNull: [{ $arrayElemAt: ["$totals.cities", 0] }, []] 
            } 
          },
          topCity: { 
            $ifNull: [{ $arrayElemAt: ["$topCity._id", 0] }, null] 
          },
          topCityCount: { 
            $ifNull: [{ $arrayElemAt: ["$topCity.count", 0] }, 0] 
          }
        }
      },
      {
        $addFields: {
          avgCustomersPerCity: {
            $round: [
              { 
                $cond: [
                  { $eq: ["$uniqueCities", 0] },
                  0,
                  { $divide: ["$totalActiveCustomers", "$uniqueCities"] }
                ]
              },
              0  // هنا غيرت من 2 إلى 0 عشان يقرب لرقم صحيح فقط
            ]
          }
        }
      },
      { 
        $project: { 
          totalActiveCustomers: 1,
          topCity: 1,
          topCityCount: 1,
          avgCustomersPerCity: 1
        } 
      }
    ]);

    res.json(stats[0] || {
      totalActiveCustomers: 0,
      topCity: null,
      topCityCount: 0,
      avgCustomersPerCity: 0
    });

  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ 
      success: false,
      message: "Error fetching stats",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const query = { companyId };
    if (!companyId) {
      return res.status(401).json({ message: '❌ لا يوجد تعريف للشركة في التوكن (Unauthorized).' });
    }

    let { fullName, city, isActive, page, limit, sort, order, rank} = req.query;

    // Validations
    if (fullName && typeof fullName !== 'string') {
      return res.status(400).json({ message: '❌ fullName يجب أن يكون نصًا.' });
    }

    if (city && typeof city !== 'string') {
      return res.status(400).json({ message: '❌ city يجب أن يكون نصًا.' });
    }

    if (isActive !== undefined && isActive !== 'true' && isActive !== 'false') {
      return res.status(400).json({ message: '❌ isActive يجب أن يكون true أو false فقط.' });
    }

    if (rank && rank.trim() !== '') {
      query.rank = rank.trim();
    }

    const allowedSortFields = ['fullName', 'city', 'isActive', 'rank'];
    const allowedOrders = ['asc', 'desc'];

    if (sort && !allowedSortFields.includes(sort)) {
      return res.status(400).json({ message: '❌ sort يجب أن يكون fullName أو city أو isActive فقط.' });
    }

    if (order && !allowedOrders.includes(order)) {
      return res.status(400).json({ message: '❌ order يجب أن يكون asc أو desc فقط.' });
    }

    if (page !== undefined) {
      const pageNum = Number(page);
      if (isNaN(pageNum) || !Number.isInteger(pageNum) || pageNum < 1) {
        return res.status(400).json({ message: '❌ page يجب أن يكون رقمًا صحيحًا وأكبر من أو يساوي 1.' });
      }
    }

    if (limit !== undefined) {
      const limitNum = Number(limit);
      if (isNaN(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: '❌ limit يجب أن يكون رقمًا صحيحًا وأكبر من أو يساوي 1.' });
      }
      if (limitNum > 50) {
        return res.status(400).json({ message: '❌ limit لا يمكن أن يتجاوز 50.' });
      }
    }

    // Build query
    

    if (fullName && fullName.trim() !== '') {
      query.fullName = { $regex: fullName.trim(), $options: 'i' };
    }

    if (city && city.trim() !== '') {
      query.city = city.trim();
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNumber = page ? Number(page) : 1;
    const limitNumber = limit ? Math.min(Number(limit), 50) : 10;

    const totalCustomers = await Customer.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalCustomers / limitNumber));
    const currentPage = Math.min(pageNumber, totalPages);
    const skip = (currentPage - 1) * limitNumber;

    // Sorting
    const sortOptions = {};
    if (sort) {
      if (sort === 'isActive') {
        sortOptions.isActive = order === 'desc' ? -1 : 1;
      } else if (sort === 'rank') {
        sortOptions.rankWeight = order === 'desc' ? 1 : -1;
      } else {
        sortOptions[sort] = order === 'desc' ? -1 : 1;
      }
    } else {
      sortOptions.fullName = 1; // Default sorting by name ascending
    }

    const customers = await Customer.find(query)
      .collation({ locale: 'ar', strength: 2 }) // ترتيب أبجدي صحيح بدون حساسية أحرف
      .skip(skip)
      .limit(limitNumber)
      .sort(sortOptions);


    res.status(200).json({ customers, totalCustomers, totalPages, currentPage });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('💥 Error in getAllCustomers:', error);
    }
    res.status(500).json({ message: '❌ خطأ داخلي في السيرفر عند جلب العملاء', error: error.message });
  }
};

// 🔍 جلب عميل بالـ ID
const getCustomerById = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ message: '❌ معرف العميل غير صالح' });
  }
  try {
    const companyId = req.user.companyId;
    const customer = await Customer.findOne({ _id: id, companyId });
    if (!customer) {
      return res.status(404).json({ message: '❌ العميل غير موجود أو ليس ضمن شركتك' });
    }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: '❌ فشل في جلب بيانات العميل', error: err.message });
  }
};

const updateCustomer = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ message: '❌ معرف العميل غير صالح' });
  }

  try {
    // لو فيه rank احسب الوزن تبعها
    if (req.body.rank) {
      req.body.rankWeight = getRankWeight(req.body.rank);
    }

    // نجيب العميل قبل التعديل
    const oldCustomer = await Customer.findById(id);
    if (!oldCustomer) {
      return res.status(404).json({ message: '❌ العميل غير موجود' });
    }

    // نحدث العميل
    const updated = await Customer.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    // احسب التغييرات الحقيقية فقط من اللي جاوا في req.body
    const changedFields = {};
    for (const key of Object.keys(req.body)) {
      // تجاهل الحقول اللي مالها داعي أو محسوبة تلقائيًا
      if (['updatedAt', 'createdAt', '__v', 'rankWeight'].includes(key)) continue;

      const newVal = req.body[key];
      const oldVal = oldCustomer[key];

      // إذا القيمة تغيرت (حتى لو رقم صار ستـرنغ)
      if (newVal?.toString() !== oldVal?.toString()) {
        changedFields[key] = newVal;
      }
    }

    // إذا صار تغييرات فعلًا
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
        },
      });
    }

    res.json(updated);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: '❌ العميل موجود مسبقًا' });
    }
    console.log(err.message)
    res.status(400).json({ message: '❌ فشل في تحديث بيانات العميل', error: err.message });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyId, userId, username } = req.user; // تأكد أن الـ username موجود في req.user

    // 1. الحصول على بيانات العميل قبل الحذف
    const customerToDelete = await Customer.findOne({ _id: id, companyId }).lean();
    if (!customerToDelete) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const adminIds = await getAdmins(req.user.companyId, req.user.userId);

    // 3. إنشاء إشعار الحذف مع حفظ نسخة العميل في previousData
    Notification.create({
      userId: userId,
      level:"warning",
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

    // 4. إزالة العميل من خطط الزيارة
    const visitPlanResult = await VisitPlan.updateMany(
      { companyId },
      { $pull: { 'days.$[].customers': { customerId: id } } }
    );

    // 5. معالجة التقارير على دفعات
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

    // 6. حذف العميل من قاعدة البيانات
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
        visitPlansCleaned: visitPlanResult.modifiedCount,
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
  getCustomerStats
};
