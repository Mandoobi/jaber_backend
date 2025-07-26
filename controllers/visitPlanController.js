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

const validateDays = (days) => {
  if (!Array.isArray(days) || days.length === 0 || days.length > 7) {
    return { valid: false, message: '🛑 يجب إرسال مصفوفة أيام بين 1 و7' };
  }

  const daySet = new Set();

  for (const dayObj of days) {
    if (!dayObj.day) {
      return { valid: false, message: '🛑 كل يوم يجب أن يحتوي على خاصية day' };
    }

    const formattedDay = dayObj.day.charAt(0).toUpperCase() + dayObj.day.slice(1).toLowerCase();

    if (!allowedDays.includes(formattedDay)) {
      return { valid: false, message: `🛑 اليوم "${dayObj.day}" غير صحيح. يجب أن يكون أحد: ${allowedDays.join(', ')}` };
    }

    if (daySet.has(formattedDay)) {
      return { valid: false, message: `🛑 اليوم "${formattedDay}" مكرر` };
    }
    daySet.add(formattedDay);

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
    }
  }

  return { valid: true };
};

const createOrUpdateVisitPlan = async (req, res) => {
  try {
    const { userId, companyId, role, username } = req.user;
    
    const repIdFromBody = req.body.repId;
    const days = req.body.days;

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

    const validationResult = validateDays(days);
    if (!validationResult.valid) return sendError(res, 400, validationResult.message);

    for (const dayObj of days) {
      const checkCustomers = dayObj.customers.map(async (custObj, i) => {
        const customer = await Customer.findById(custObj.customerId);
        if (!customer) throw new Error(`📛 العميل ${custObj.customerId} غير موجود`);
        if (customer.companyId.toString() !== companyId.toString()) {
          throw new Error(`🚫 لا يمكن إضافة عميل من شركة أخرى في خطة الزيارات`);
        }
        dayObj.customers[i].fullName = customer.fullName;
      });
      await Promise.all(checkCustomers);
    }

    let plan = await VisitPlan.findOne({ repId, companyId });
    const adminIds = await getAdmins(companyId, userId);

    const FIVE_MINUTES_AGO = now().subtract(15, 'minute').toDate();

    if (plan) {
      plan.days = days;
      await plan.save();

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

      return sendSuccess(res, 200, '✅ تم تحديث خطة الزيارات بنجاح', plan);
    } else {
      plan = new VisitPlan({ repId, companyId, days });
      await plan.save();

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

      return sendSuccess(res, 201, '✅ تم إنشاء خطة زيارات جديدة بنجاح', plan);
    }
  } catch (err) {
    console.error('❌ Error in createOrUpdateVisitPlan:', err);
    if (err.message.startsWith('📛') || err.message.startsWith('🚫')) {
      return sendError(res, 400, err.message);
    }
    return sendError(res, 500, '❌ خطأ في السيرفر، حاول مرة أخرى لاحقاً');
  }
};

const getVisitPlan = async (req, res) => {
  try {
    const { userId, companyId, role } = req.user;
    const { repId: repIdQuery, day: dayQuery } = req.query;

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

    let plans = await VisitPlan.find(filter).lean();

    if (dayQuery) {
      const formattedDay = dayQuery.charAt(0).toUpperCase() + dayQuery.slice(1).toLowerCase();
      if (!allowedDays.includes(formattedDay)) return sendError(res, 400, '📛 اليوم غير صالح');

      plans = plans.map(plan => {
        const filteredDays = plan.days.filter(d => d.day === formattedDay);
        return { ...plan, days: filteredDays };
      });
      if (plans.length === 1) plans = plans[0];
    } else {
      if (plans.length === 1) plans = plans[0];
    }

    if (!plans || (Array.isArray(plans) && plans.length === 0)) {
      return sendError(res, 404, '❌ خطة زيارات غير موجودة');
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

    // Use the dayjs utility with Asia/Hebron timezone
    const today = now().format('dddd');

    if (!allowedDays.includes(today)) return sendError(res, 400, '📛 اليوم غير صالح');

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

    const plan = await VisitPlan.findOne({ repId, companyId }).lean();
    if (!plan) return sendError(res, 404, '❌ لا توجد خطة زيارات لهذا المندوب');

    const todayPlan = plan.days.find(d => d.day === today);
    if (!todayPlan) return sendError(res, 404, `❌ لا توجد زيارات مجدولة اليوم (${today})`);

    return sendSuccess(res, 200, '✅ تم جلب خطة زيارات اليوم بنجاح', todayPlan);
    
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