const VisitPlan = require('../models/VisitPlan');
const User = require('../models/User');
const Customer = require('../models/Customer');
const mongoose = require('mongoose');
const { now } = require('../utils/dayjs');
const Notification = require('../models/Notification');

const sendError = (res, status, message) => res.status(status).json({ message });
const sendSuccess = (res, status, message, data) =>
  res.status(status).json({ message, ...(data && { data }) });

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const allowedDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const getAdmins = async (companyId, excludeUserId = null) => {
  let query = { companyId, role: 'admin' };
  let admins = await User.find(query, '_id');

  let adminIds = admins.map(admin => admin._id.toString());

  if (excludeUserId) {
    adminIds = adminIds.filter(id => id !== excludeUserId.toString());
  }

  return adminIds;
};

const validateDays = async (days, companyId) => {
  if (!Array.isArray(days) || days.length === 0 || days.length > 28) {
    return { valid: false, message: '🛑 يجب إرسال مصفوفة أيام بين 1 و28' };
  }

  const daySet = new Set();
  const customerIds = [];

  // Debug: Track all customer data for validation
  const allCustomerData = [];

  for (const dayObj of days) {
    if (!dayObj.day) {
      return { valid: false, message: '🛑 كل يوم يجب أن يحتوي على خاصية day' };
    }

    if (typeof dayObj.weekNumber !== 'number' || dayObj.weekNumber < 1 || dayObj.weekNumber > 4) {
      return { valid: false, message: `🛑 يجب تحديد weekNumber صحيح بين 1 و 4 لكل يوم زيارة` };
    }

    const formattedDay = dayObj.day.charAt(0).toUpperCase() + dayObj.day.slice(1).toLowerCase();

    if (!allowedDays.includes(formattedDay)) {
      return { valid: false, message: `🛑 اليوم "${dayObj.day}" غير صحيح. يجب أن يكون أحد: ${allowedDays.join(', ')}` };
    }

    const dayKey = `${formattedDay}-${dayObj.weekNumber}`;
    if (daySet.has(dayKey)) {
      return { valid: false, message: `🛑 اليوم "${formattedDay}" مع الأسبوع "${dayObj.weekNumber}" مكرر` };
    }
    daySet.add(dayKey);

    if (!Array.isArray(dayObj.customers)) {
      return { valid: false, message: `🛑 customers في يوم ${formattedDay} يجب أن تكون مصفوفة` };
    }

    const customerSet = new Set();
    for (const customer of dayObj.customers) {
      if (!customer.customerId || !isValidObjectId(customer.customerId)) {
        return { valid: false, message: `🛑 customerId غير صالح في يوم ${formattedDay}` };
      }
      if (customerSet.has(customer.customerId.toString())) {
        return { valid: false, message: `🛑 يوجد عميل مكرر في يوم ${formattedDay}` };
      }
      customerSet.add(customer.customerId.toString());
      customerIds.push(customer.customerId);
      allCustomerData.push({
        day: formattedDay,
        weekNumber: dayObj.weekNumber,
        customerId: customer.customerId,
        customerName: customer.fullName || 'غير معروف'
      });
    }
  }

  // Enhanced customer verification with detailed debugging
  console.log('\n=== DEBUG: CUSTOMER VALIDATION START ===');
  console.log('Validating for companyId:', companyId);
  console.log('Total customers to validate:', customerIds.length);
  console.log('Customer IDs:', customerIds);

  const customers = await Customer.find({
    _id: { $in: customerIds }
  }).select('_id fullName companyId customer_code isActive').lean();

  console.log('\n=== DATABASE RESULTS ===');
  console.log('Found customers:', customers.length);
  console.log('Customer details:', customers.map(c => ({
    _id: c._id,
    name: c.fullName,
    company: c.companyId,
    active: c.isActive
  })));

  const invalidCustomers = [];
  const validCustomers = [];

  customerIds.forEach(customerId => {
    const customer = customers.find(c => c._id.toString() === customerId.toString());
    if (!customer) {
      invalidCustomers.push({
        customerId,
        reason: 'غير موجود في قاعدة البيانات'
      });
    } else if (customer.companyId.toString() !== companyId.toString()) {
      invalidCustomers.push({
        customerId,
        reason: `ينتمي لشركة أخرى (${customer.companyId})`
      });
    } else if (customer.isActive === false) {
      invalidCustomers.push({
        customerId,
        reason: 'غير نشط'
      });
    } else {
      validCustomers.push(customer);
    }
  });

  if (invalidCustomers.length > 0) {
    console.log('\n=== INVALID CUSTOMERS ===');
    console.log('Count:', invalidCustomers.length);
    console.table(invalidCustomers);

    // Find the original day assignments for invalid customers
    const invalidWithContext = invalidCustomers.map(invalid => {
      const customerData = allCustomerData.find(c => c.customerId.toString() === invalid.customerId.toString());
      return {
        ...invalid,
        day: customerData?.day || 'غير معروف',
        weekNumber: customerData?.weekNumber || 'غير معروف',
        customerName: customerData?.customerName || 'غير معروف'
      };
    });

    return {
      valid: false,
      message: `🛑 بعض العملاء غير صالحين (${invalidCustomers.length} من ${customerIds.length})`,
      debug: {
        expectedCompany: companyId,
        invalidCustomers: invalidWithContext,
        validCustomers: validCustomers.map(c => c._id)
      }
    };
  }

  console.log('\n=== VALIDATION SUCCESS ===');
  console.log('All customers are valid and belong to company', companyId);
  return { valid: true, customers: validCustomers };
};

const createOrUpdateVisitPlan = async (req, res) => {
  try {
    const { userId, companyId, role, username } = req.user;
    const { repId: repIdFromBody, days } = req.body;

    if (!Array.isArray(days) || days.length !== 1) {
      return sendError(res, 400, '📛 يجب إرسال يوم واحد فقط للتحديث');
    }

    const dayToUpdate = days[0];

    // Validate day and weekNumber
    if (!dayToUpdate.day) return sendError(res, 400, '📛 يجب تحديد اسم اليوم');
    if (typeof dayToUpdate.weekNumber !== 'number' || dayToUpdate.weekNumber < 1 || dayToUpdate.weekNumber > 4) {
      return sendError(res, 400, '📛 يجب تحديد weekNumber صحيح بين 1 و 4');
    }

    let repId;

    if (role === 'admin') {
      if (!repIdFromBody) return sendError(res, 400, '📛 يجب إرسال repId للأدمن');
      if (!isValidObjectId(repIdFromBody)) return sendError(res, 400, '📛 معرف المندوب غير صالح');
      repId = repIdFromBody;

      const repUser = await User.findById(repId);
      if (!repUser) return sendError(res, 404, '🚫 المندوب غير موجود');
      if (!repUser.companyId || repUser.companyId.toString() !== companyId.toString()) {
        return sendError(res, 403, '🚫 المندوب غير تابع للشركة الخاصة بك');
      }
    } else {
      repId = userId;
    }

    // Validate day structure
    const validationResult = await validateDays([dayToUpdate], companyId);
    if (!validationResult.valid) {
      return sendError(res, 400, {
        message: validationResult.message,
        debug: process.env.NODE_ENV === 'development' ? validationResult.debug : undefined
      });
    }

    // Prepare enhanced customer info
    const customerMap = new Map();
    validationResult.customers.forEach(customer => {
      customerMap.set(customer._id.toString(), {
        fullName: customer.fullName,
        customer_code: customer.customer_code || null
      });
    });

    const enhancedDay = {
      day: dayToUpdate.day,
      weekNumber: dayToUpdate.weekNumber,
      title: dayToUpdate.title || null, // هنا أضفنا العنوان (اختياري)
      customers: dayToUpdate.customers.map(customer => ({
        customerId: customer.customerId,
        fullName: customerMap.get(customer.customerId.toString())?.fullName || customer.fullName,
        customer_code: customerMap.get(customer.customerId.toString())?.customer_code || null
      }))
    };

    // Find or create visit plan
    let plan = await VisitPlan.findOne({ repId, companyId });
    const adminIds = await getAdmins(companyId, userId);
    const FIVE_MINUTES_AGO = now().subtract(15, 'minute').toDate();

    if (plan) {
      // Replace the day if exists, else add
      const dayKeyToUpdate = `${enhancedDay.day}-${enhancedDay.weekNumber}`;
      let replaced = false;

      plan.days = plan.days.map(d => {
        const currentKey = `${d.day}-${d.weekNumber}`;
        if (currentKey === dayKeyToUpdate) {
          replaced = true;
          return enhancedDay;
        }
        return d;
      });

      if (!replaced) {
        plan.days.push(enhancedDay);
      }

      await plan.save();

      // Notification for update
      const recentNotification = await Notification.findOne({
        userId,
        actionType: 'update_visit_line',
        targetUsers: { $all: adminIds },
        createdAt: { $gte: FIVE_MINUTES_AGO }
      });

      if (!recentNotification) {
        await Notification.create({
          userId,
          targetUsers: adminIds,
          actionType: 'update_visit_line',
          description: `المستخدم ${username || 'مستخدم'} حدّث خطة الزيارات اليومية.`,
          relatedEntity: {
            entityType: 'VisitPlan',
            entityId: plan._id,
          },
        });
      }

      return sendSuccess(res, 200, '✅ تم تحديث خطة الزيارات ليوم واحد بنجاح', plan);
    } else {
      // No plan exists: create with single day
      plan = new VisitPlan({ repId, companyId, days: [enhancedDay] });
      await plan.save();

      // Notification for create
      const recentNotification = await Notification.findOne({
        userId,
        actionType: 'add_visit_line',
        targetUsers: { $all: adminIds },
        createdAt: { $gte: FIVE_MINUTES_AGO }
      });

      if (!recentNotification) {
        await Notification.create({
          userId,
          targetUsers: adminIds,
          actionType: 'add_visit_line',
          description: `المستخدم ${username || 'مستخدم'} أنشأ خطة زيارات يومية جديدة.`,
          relatedEntity: {
            entityType: 'VisitPlan',
            entityId: plan._id,
          },
        });
      }

      return sendSuccess(res, 201, '✅ تم إنشاء خطة زيارات جديدة ليوم واحد بنجاح', plan);
    }
  } catch (err) {
    console.error('\n❌ ERROR IN VISIT PLAN UPDATE ❌');
    console.error('Error:', err);
    console.error('Request body:', req.body);

    if (err.message.startsWith('📛') || err.message.startsWith('🚫')) {
      return sendError(res, 400, err.message);
    }
    return sendError(res, 500, {
      message: '❌ خطأ في السيرفر، حاول مرة أخرى لاحقاً',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getVisitPlan = async (req, res) => {
  try {
    const { userId, companyId, role } = req.user;
    const { repId: repIdQuery, day: dayQuery, weekNumber: weekNumberQuery } = req.query;

    if (!companyId) return sendError(res, 400, '🚫 companyId غير موجود في بيانات المستخدم');
    if (!isValidObjectId(companyId)) return sendError(res, 400, '🚫 companyId غير صالح');

    let filter = { companyId };

    if (role === 'admin') {
      if (repIdQuery) {
        if (!mongoose.Types.ObjectId.isValid(repIdQuery)) return sendError(res, 400, '📛 معرف المندوب غير صالح');
        const repUser = await User.findById(repIdQuery);
        if (!repUser) return sendError(res, 404, '🚫 المندوب غير موجود');
        if (!repUser.companyId || repUser.companyId.toString() !== companyId.toString()) {
          return sendError(res, 403, '🚫 المندوب غير تابع للشركة الخاصة بك');
        }
        filter.repId = repIdQuery;
      }
    } else {
      filter.repId = userId;
    }

    let plans = await VisitPlan.find(filter)
      .populate({
        path: 'repId',
        select: '_id fullName email phone'
      })
      .lean();

    // إذا في فلترة ليوم محدد مع رقم الأسبوع
    if (dayQuery && weekNumberQuery) {
      const formattedDay = dayQuery.charAt(0).toUpperCase() + dayQuery.slice(1).toLowerCase();
      const weekNum = parseInt(weekNumberQuery, 10);

      if (!allowedDays.includes(formattedDay)) return sendError(res, 400, '📛 اليوم غير صالح');
      if (isNaN(weekNum) || weekNum < 1 || weekNum > 4) return sendError(res, 400, '📛 رقم الأسبوع غير صالح');

      plans = plans.map(plan => {
        const filteredDays = plan.days.filter(d => d.day === formattedDay && d.weekNumber === weekNum);
        return { ...plan, days: filteredDays };
      });

      if (plans.length === 1) plans = plans[0];
    }

    if (!plans || (Array.isArray(plans) && plans.length === 0)) {
      return sendError(res, 404, '❌ خطة زيارات غير موجودة');
    }

    // جلب بيانات العملاء لتحسين الرد، فقط للأيام المعادة (قد تكون يوم واحد)
    if (Array.isArray(plans)) {
      for (const plan of plans) {
        for (const day of plan.days) {
          day.customers = await Promise.all(day.customers.map(async customer => {
            const customerData = await Customer.findById(customer.customerId)
              .select('fullName phone city address customer_code isActive')
              .lean();
            return {
              ...customer,
              customerInfo: customerData || null
            };
          }));
        }
      }
    } else {
      for (const day of plans.days) {
        day.customers = await Promise.all(day.customers.map(async customer => {
          const customerData = await Customer.findById(customer.customerId)
            .select('fullName phone city address customer_code isActive')
            .lean();
          return {
            ...customer,
            customerInfo: customerData || null
          };
        }));
      }
    }

    return sendSuccess(res, 200, '✅ تم جلب خطة الزيارات بنجاح', plans);
  } catch (err) {
    console.error('❌ Error in getVisitPlan:', err);
    return sendError(res, 500, '❌ خطأ في السيرفر، حاول مرة أخرى لاحقاً');
  }
};

const getTodayVisitPlan = async (req, res) => {
  try {
    const { userId, role, companyId } = req.user;
    const repIdFromQuery = req.query.repId;

    // احصل على اسم اليوم الحالي كامل، مثل 'Sunday'
    const today = now().format('dddd');
    if (!allowedDays.includes(today)) return sendError(res, 400, '📛 اليوم غير صالح');

    // احسب رقم الأسبوع الحالي في الشهر (1-4)
    const currentDate = now().toDate();
    const dayOfMonth = currentDate.getDate();
    const weekNumber = Math.ceil(dayOfMonth / 7);

    let repId;

    if (role === 'admin') {
      if (!repIdFromQuery || !isValidObjectId(repIdFromQuery)) {
        return sendError(res, 400, '📛 يجب إرسال repId صالح للأدمن');
      }

      const repUser = await User.findById(repIdFromQuery);
      if (!repUser || !repUser.companyId || repUser.companyId.toString() !== companyId.toString()) {
        return sendError(res, 403, '🚫 هذا المندوب لا يتبع لشركتك');
      }
      repId = repIdFromQuery;
    } else {
      repId = userId;
    }

    const plan = await VisitPlan.findOne({ repId, companyId })
      .populate({
        path: 'repId',
        select: '_id fullName email phone'
      })
      .lean();

    if (!plan) return sendError(res, 404, '❌ لا توجد خطة زيارات لهذا المندوب');

    // اختار اليوم الحالي ورقم الأسبوع المناسب
    const todayPlan = plan.days.find(d => d.day === today && d.weekNumber === weekNumber);
    if (!todayPlan) return sendError(res, 404, `❌ لا توجد زيارات مجدولة اليوم (${today} - الأسبوع ${weekNumber})`);

    // جلب بيانات العملاء لليوم
    todayPlan.customers = await Promise.all(todayPlan.customers.map(async customer => {
      const customerData = await Customer.findById(customer.customerId)
        .select('fullName phone city address customer_code isActive')
        .lean();
      return {
        ...customer,
        customerInfo: customerData || null
      };
    }));

    return sendSuccess(res, 200, '✅ تم جلب خطة زيارات اليوم بنجاح', {
      ...todayPlan,
      repInfo: {
        _id: plan.repId._id,
        fullName: plan.repId.fullName,
        email: plan.repId.email,
        phone: plan.repId.phone
      }
    });

  } catch (err) {
    console.error('❌ Error in getTodayVisitPlan:', err);
    return sendError(res, 500, '❌ خطأ في السيرفر، حاول مرة أخرى لاحقاً');
  }
};

const deleteVisitPlanDay = async (req, res) => {
  try {
    const { userId, role, companyId } = req.user;
    const { repId: repIdParam, dayName } = req.params;

    const formattedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase();
    if (!allowedDays.includes(formattedDay)) return sendError(res, 400, '📛 اليوم غير صالح');

    const repId = role === 'admin' ? repIdParam : userId;

    if (role === 'admin') {
      const user = await User.findById(repId).select('companyId');
      if (!user || !user.companyId || user.companyId.toString() !== companyId.toString()) {
        return sendError(res, 403, '🚫 هذا المندوب لا يتبع لشركتك');
      }
    }

    const plan = await VisitPlan.findOne({ repId, companyId });
    if (!plan) return sendError(res, 404, '❌ لا توجد خطة زيارات لهذا المندوب');

    const originalLength = plan.days.length;
    plan.days = plan.days.filter(d => d.day !== formattedDay);

    if (plan.days.length === originalLength) {
      return sendError(res, 404, `❌ لا يوجد يوم ${formattedDay} في الخطة لحذفه`);
    }

    await plan.save();
    return sendSuccess(res, 200, `✅ تم حذف يوم ${formattedDay} من الخطة بنجاح`);
  } catch (err) {
    console.error('❌ Error in deleteVisitPlanDay:', err);
    return sendError(res, 500, '❌ خطأ في السيرفر، حاول مرة أخرى لاحقاً');
  }
};

module.exports = {
  createOrUpdateVisitPlan,
  getVisitPlan,
  deleteVisitPlanDay,
  getTodayVisitPlan
};