const mongoose = require('mongoose');
const User = require('../models/User');
const CustomerAssignment = require('../models/CustomerAssignment');
const DailyReport = require('../models/DailyReport');
const VisitPlan = require('../models/VisitPlan'); // تأكد أنك مستورد الموديل
const Customer = require('../models/Customer');
const { now } = require('../utils/dayjs')

const getAdminStats = async (req, res) => {
  try {
    const { companyId } = req.user;
    const companyObjectId = new mongoose.Types.ObjectId(companyId);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // تنفيذ الاستعلامات متوازية
    const [totalCustomers, reportsSubmittedToday, completedVisitsAgg] = await Promise.all([
      Customer.countDocuments({ companyId: companyObjectId }),
      DailyReport.countDocuments({ companyId: companyObjectId, date: today }),
      DailyReport.aggregate([
        { $match: { companyId: companyObjectId, date: today } },
        { $unwind: '$visits' },
        { $match: { 'visits.status': 'visited' } },
        { $count: 'completedVisits' }
      ])
    ]);

    const completedVisits = completedVisitsAgg.length > 0 ? completedVisitsAgg[0].completedVisits : 0;
    const pendingTasks = 0; // موقتا!!!

    return res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        reportsSubmittedToday,
        completedVisits,
        pendingTasks
      }
    });

  } catch (error) {
    console.error('getAdminStats error:', error);
    return res.status(500).json({ success: false, message: '❌ خطأ في جلب إحصائيات الأدمن' });
  }
};

const getSalesStats = async (req, res) => {
  try {
    const { companyId, userId, role } = req.user;
    const today = now().format('dddd'); // "Sunday", "Monday", ...

    // 🟡 جلب خط الزيارات
    const visitPlan = await VisitPlan.findOne({ repId: userId, companyId }).lean();
    if (!visitPlan) {
      return res.status(200).json({
        success: true,
        data: {
          customersToVisitToday: 0,
          reportSubmittedToday: false,
          assignedTasks: 0,
          totalCustomers: 0,
          message: '❌ لم يتم إنشاء خط زيارات لهذا المندوب'
        }
      });
    }

    const todayVisits = visitPlan.days.find(day => day.day === today);
    if (!todayVisits) {
      return res.status(200).json({
        success: true,
        data: {
          customersToVisitToday: 0,
          reportSubmittedToday: false,
          assignedTasks: 0,
          totalCustomers: 0,
          message: `❌ لم يتم تحديد زيارات لهذا اليوم (${today})`
        }
      });
    }

    // ✅ عدد العملاء المتوقع زيارتهم
    const customersToVisitToday = todayVisits.customers.length;

    // ✅ هل تم إرسال التقرير اليوم؟
    const todayDate = now().format('YYYY-MM-DD');
    const reportSubmittedToday = await DailyReport.exists({
      companyId,
      repId: userId,
      date: todayDate
    });

    // Get total customers count
    let totalCustomers;
    if (role === 'rep' || role === 'sales') {
      // For reps, count only their assigned customers + public ones
      const companyCustomerIds = await Customer.find({ companyId }).distinct('_id');
      const assignedCustomerIds = await CustomerAssignment.distinct('customerId', {
        repId: userId,
        customerId: { $in: companyCustomerIds }
      });

      totalCustomers = await Customer.countDocuments({
        companyId,
        isActive: true,
        $or: [
          { isPublic: true },
          { _id: { $in: assignedCustomerIds } }
        ]
      });
    } else {
      // For admins, count all active customers
      totalCustomers = await Customer.countDocuments({
        companyId,
        isActive: true
      });
    }

    // المهام مؤقتًا 0
    const assignedTasks = 0;

    return res.status(200).json({
      success: true,
      data: {
        customersToVisitToday,
        reportSubmittedToday: !!reportSubmittedToday,
        assignedTasks,
        totalCustomers
      }
    });

  } catch (error) {
    console.error('getSalesStats error:', error);
    return res.status(500).json({
      success: false,
      message: '❌ خطأ في جلب إحصائيات المبيعات',
      error: error.message
    });
  }
};

module.exports = { getAdminStats, getSalesStats };
