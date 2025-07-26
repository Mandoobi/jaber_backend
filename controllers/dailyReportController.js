const mongoose = require('mongoose');
const User = require('../models/User');
const DailyReport = require('../models/DailyReport');
const Customer = require('../models/Customer');
const VisitPlan = require('../models/VisitPlan');
const Notification = require('../models/Notification');
const calculateVisitStats = require('../utils/visitStats');
const { now, parseWithTZ, dayjs } = require('../utils/dayjs');

const sendError = (res, status, message) => res.status(status).json({ success: false, message });
const sendSuccess = (res, status, message, data = null) =>
  res.status(status).json({ success: true, message, ...(data && { data }) });

const verifyCustomers = async (customerIds, companyId) => {
  try {
    // Validate all customer IDs
    const invalidIds = customerIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return `📛 تحتوي على معرفات عملاء غير صالحة: ${invalidIds.join(', ')}`;
    }

    // Convert to ObjectId
    const customerObjectIds = customerIds.map(id => new mongoose.Types.ObjectId(id));
    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    // Find customers and verify company match
    const customers = await Customer.find({
      _id: { $in: customerObjectIds }
    }).select('_id companyId').lean();

    // Verify each customer
    const invalidCustomers = [];
    for (const customerId of customerObjectIds) {
      const customer = customers.find(c => c._id.equals(customerId));
      
      if (!customer) {
        invalidCustomers.push({
          id: customerId,
          reason: 'not_found'
        });
        continue;
      }

      if (!customer.companyId.equals(companyObjectId)) {
        invalidCustomers.push({
          id: customerId,
          reason: 'company_mismatch',
          customerCompany: customer.companyId.toString(),
          expectedCompany: companyObjectId.toString()
        });
      }
    }

    if (invalidCustomers.length > 0) {
      console.error('Validation failed with:', invalidCustomers);
      const invalidIds = invalidCustomers.map(c => c.id.toString());
      return `📛 العملاء التالية غير موجودين أو لا ينتمون لشركتك: ${invalidIds.join(', ')}`;
    }

    return null;
  } catch (error) {
    console.error('Verification error:', error);
    return '❌ خطأ في التحقق من العملاء';
  }
};

const getAdmins = async (companyId, excludeUserId = null) => {
  let query = { companyId, role: 'admin' };
  let admins = await User.find(query, '_id');

  let adminIds = admins.map(admin => admin._id.toString());

  if (excludeUserId) {
    adminIds = adminIds.filter(id => id !== excludeUserId.toString());
  }

  return adminIds;
};

const getSingleReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, userId, companyId } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, '📛 معرف التقرير غير صالح');
    }

    // First verify the report exists and belongs to the company
    const report = await DailyReport.findOne({ _id: id, companyId })
      .populate({
        path: 'repId',
        match: { companyId }, // Ensure rep belongs to same company
        select: '_id fullName name email phone'
      })
      .populate({
        path: 'visits.customerId',
        match: { companyId }, // Ensure customers belong to same company
        select: '_id fullName phone isActive city address',
        options: { lean: true }
      })
      .lean();

    if (!report) {
      return sendError(res, 404, '❌ التقرير غير موجود أو لا ينتمي لشركتك');
    }

    // Additional check if repId was filtered out by population
    if (!report.repId) {
      return sendError(res, 403, '🚫 لا يمكنك الوصول إلى هذا التقرير');
    }

    // Authorization check for sales reps
    if (role === 'sales') {
      // Verify the report belongs to the requesting sales user
      if (report.repId._id.toString() !== userId) {
        return sendError(res, 403, '🚫 لا يمكنك الوصول إلى تقارير مندوبين آخرين');
      }
      
      // Additional security: Verify the sales user is active and belongs to the company
      const userValid = await User.exists({
        _id: userId,
        companyId,
        role: 'sales',
        isActive: true
      });
      
      if (!userValid) {
        return sendError(res, 403, '🚫 حسابك غير مفعل أو لا ينتمي لهذه الشركة');
      }
    } else if (role === 'admin') {
      // For admins, verify the report's rep belongs to their company
      const repValid = await User.exists({
        _id: report.repId._id,
        companyId,
        role: 'sales'
      });
      
      if (!repValid) {
        return sendError(res, 403, '🚫 المندوب لا ينتمي لشركتك');
      }
    }

    // Filter out any visits where customer doesn't belong to company
    const validVisits = report.visits.filter(visit => visit.customerId !== null);

    // Format the report
    const formattedReport = {
      ...report,
      visits: validVisits,
      repInfo: {
        name: report.repId.fullName,
        email: report.repId.email,
        phone: report.repId.phone
      },
      visits: validVisits.map(visit => ({
        ...visit,
        customerInfo: {
          name: visit.customerId?.fullName || '[Deleted Customer]',
          phone: visit.customerId?.phone || 'N/A',
          city: visit.customerId?.city || 'N/A',
          address: visit.customerId?.isActive ? visit.customerId.address : 'N/A',
          isActive: visit.customerId?.isActive ?? false
        }
      })),
      stats: {
        ...report.stats,
        date: report.date,
        day: report.day
      }
    };

    return sendSuccess(res, 200, '✅ تم جلب التقرير بنجاح', { 
      report: formattedReport,
      pdfMeta: {
        title: `Daily Report - ${report.date}`,
        header: {
          date: report.date,
          repName: report.repId.fullName,
          totalVisits: report.stats.totalVisits,
          completedVisits: report.stats.completedVisits
        },
        printableSections: ['visits']
      }
    });

  } catch (error) {
    console.error('[GET SINGLE REPORT ERROR]', error);
    return sendError(res, 500, '❌ خطأ في الخادم الداخلي');
  }
};

const createOrUpdateReport = async (req, res) => {
  try {
    const { role, userId, companyId, username } = req.user;
    const { notes, visits, reportId } = req.body;

    if (!visits || !Array.isArray(visits)) {
      return sendError(res, 400, '📛 يجب تقديم قائمة زيارات صالحة');
    }

    const cleanedVisits = visits.map(v => {
      const visit = {
        customerId: v.customerId,
        status: v.status,
        reason: v.reason || '',
        notes: v.notes || '',
        isExtra: v.isExtra || false
      };
      if (v.status === 'visited' && v.duration !== null) {
        visit.duration = v.duration;
      }
      return visit;
    });

    const customerIds = cleanedVisits.map(v => v.customerId);
    const customersError = await verifyCustomers(customerIds, companyId);
    if (customersError) return sendError(res, 400, customersError);

    const currentDate = now(); // Using your timezone-aware now() function
    const dateStr = currentDate.format('YYYY-MM-DD');
    const day = currentDate.format('dddd');

    if (role === 'sales') {
      let existingReport = await DailyReport.findOne({ repId: userId, companyId, date: dateStr });

      if (reportId && (!existingReport || !existingReport._id.equals(reportId))) {
        return sendError(res, 400, '📛 يمكنك فقط تعديل تقرير اليوم الخاص بك');
      }

      const visitPlan = await VisitPlan.findOne({ repId: userId, companyId }).lean();
      let plannedCustomerIds = [];

      if (visitPlan) {
        const todayPlan = visitPlan.days.find(d => d.day === day);
        if (todayPlan?.customers) {
          plannedCustomerIds = todayPlan.customers.map(c => c.customerId.toString());
        }
      }

      const processedVisits = cleanedVisits.map(v => ({
        ...v,
        isExtra: !plannedCustomerIds.includes(v.customerId.toString())
      }));

      const stats = calculateVisitStats(processedVisits);

      if (existingReport) {
        existingReport.notes = notes || existingReport.notes;
        existingReport.visits = processedVisits;
        existingReport.stats = stats;
        await existingReport.save();

        return sendSuccess(res, 200, '✅ تم تحديث التقرير بنجاح', { report: existingReport });
      } else {
        const newReport = new DailyReport({
          companyId,
          repId: userId,
          date: dateStr,
          day,
          notes: notes || '',
          visits: processedVisits,
          stats
        });
        await newReport.save();

        const recentNotification = await Notification.findOne({
          actionType: 'send_daily_report',
          'relatedEntity.entityType': 'DailyReport',
          'relatedEntity.entityId': newReport._id,
          createdAt: { $gte: now().subtract(60, 'minutes').toDate() }
        });

        if (!recentNotification) {
          const adminIds = await getAdmins(companyId, userId);

          await Notification.create({
            userId,
            targetUsers: adminIds,
            actionType: 'send_daily_report',
            type: 'info',
            description: `📝 تم إرسال التقرير اليومي من المندوب ${username || 'غير معروف'}`,
            relatedEntity: {
              entityType: 'DailyReport',
              entityId: newReport._id
            }
          });
        }

        return sendSuccess(res, 201, '✅ تم إنشاء التقرير بنجاح', { report: newReport });
      }
    }

    if (role === 'admin') {
      if (!reportId) return sendError(res, 400, '📛 يجب تقديم معرف التقرير للتحديث');

      const existingReport = await DailyReport.findOne({ _id: reportId, companyId });
      if (!existingReport) return sendError(res, 404, '❌ التقرير غير موجود أو لا ينتمي لشركتك');

      const stats = calculateVisitStats(cleanedVisits);
      existingReport.notes = notes || existingReport.notes;
      existingReport.visits = cleanedVisits;
      existingReport.stats = stats;

      await existingReport.save();
      return sendSuccess(res, 200, '✅ تم تحديث التقرير بنجاح بواسطة المدير', {
        report: existingReport
      });
    }

    return sendError(res, 403, '🚫 غير مصرح لك بهذا الإجراء');
  } catch (error) {
    console.error('❌ Error in createOrUpdateReport:', error);
    return sendError(res, 500, '❌ خطأ في الخادم الداخلي');
  }
};

const getReports = async (req, res) => {
  try {
    const { userId, role, companyId } = req.user;
    const {
      startDate,
      endDate,
      dateRange,
      repId,
      page = 1,
      limit = 10,
      sortBy = 'date',
      sortOrder = 'desc',
      customerName
    } = req.query;

    // Base query - always filter by company
    const query = { companyId };

    // Authorization logic
    if (role === 'sales') {
      // Sales can only see their own reports
      query.repId = userId;
      
      // If they try to specify a repId, return error
      if (repId && repId !== userId.toString()) {
        return sendError(res, 403, '🚫 لا يمكنك الوصول إلى تقارير مندوبين آخرين');
      }
    } else if (role === 'admin') {
      // Admin can filter by repId but only within their company
      if (repId) {
        if (!mongoose.Types.ObjectId.isValid(repId)) {
          return sendError(res, 400, 'معرف المندوب غير صالح');
        }
        
        // Verify the requested rep belongs to the same company
        const repExists = await User.exists({
          _id: repId,
          companyId,
          role: 'sales'
        });
        
        if (!repExists) {
          return sendError(res, 403, '🚫 المندوب المطلوب غير موجود أو لا ينتمي لشركتك');
        }
        
        query.repId = repId;
      }
    }

    const today = now().format('YYYY-MM-DD');
    if (dateRange) {
      if (dateRange === 'today') {
        query.date = { $eq: today };
      } else if (dateRange === 'week') {
        const weekAgo = now().subtract(7, 'day').format('YYYY-MM-DD');
        query.date = { $gte: weekAgo, $lte: today };
      } else if (dateRange === 'month') {
        const monthAgo = now().subtract(30, 'day').format('YYYY-MM-DD');
        query.date = { $gte: monthAgo, $lte: today };
      }
    } else if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = parseWithTZ(startDate).format('YYYY-MM-DD');
      if (endDate) query.date.$lte = parseWithTZ(endDate).format('YYYY-MM-DD');
    }

    let sort = {};
    if (sortBy === 'visits') {
      sort = null;
    } else {
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    }

    let reportsQuery = DailyReport.find(query)
      .populate({
        path: 'repId',
        match: { companyId }, // Ensure populated rep belongs to same company
        select: '_id fullName name email'
      })
      .populate({
        path: 'visits.customerId',
        match: { companyId }, // Ensure populated customers belong to same company
        select: '_id fullName phone isActive'
      })
      .lean();

    if (sort) reportsQuery = reportsQuery.sort(sort);

    const allReports = await reportsQuery;

    let sortedReports = allReports;
    if (sortBy === 'visits') {
      sortedReports = allReports.sort((a, b) => {
        const countA = (a.visits || []).filter(v => v.status === 'visited').length;
        const countB = (b.visits || []).filter(v => v.status === 'visited').length;
        const diff = countA - countB;
        return sortOrder === 'asc' ? diff : -diff;
      });
    }

    if (customerName) {
      const lowerName = customerName.toLowerCase();
      sortedReports = sortedReports.filter(report =>
        report.visits?.some(visit =>
          visit.customerId?.fullName?.toLowerCase().includes(lowerName)
      ));
    }

    const totalReports = sortedReports.length;
    const totalPages = Math.ceil(totalReports / limit);
    const currentPage = Math.max(1, parseInt(page));
    const skip = (currentPage - 1) * limit;
    const paginatedReports = sortedReports.slice(skip, skip + parseInt(limit));

    const sentToday = await DailyReport.exists({
      companyId,
      repId: role === 'sales' ? userId : (repId ? repId : null),
      date: today
    });

    const formattedReports = paginatedReports.map(report => ({
      id: report._id,
      companyId: report.companyId,
      representative: report.repId ? {
        id: report.repId._id,
        name: report.repId.name,
        fullName: report.repId.fullName || report.repId.name || report.repId.email?.split('@')[0],
        email: report.repId.email
      } : null,
      repId: report.repId?._id || null,
      date: report.date,
      day: report.day,
      notes: report.notes,
      stats: report.stats,
      visits: report.visits.map(visit => {
        const customer = visit.customerId;
        return {
          id: visit._id,
          customerId: customer?._id || null,
          status: visit.status,
          reason: visit.reason,
          notes: visit.notes,
          duration: visit.duration,
          isExtra: visit.isExtra,
          customer: customer ? {
            id: customer._id,
            name: customer.isActive ? customer.fullName : '[Deleted Customer]',
            phone: customer.isActive ? customer.phone : null,
            isActive: customer.isActive
          } : null
        };
      }),
      createdAt: report.createdAt,
      updatedAt: report.updatedAt
    }));

    return res.status(200).json({
      success: true,
      data: {
        page: currentPage,
        limit: Number(limit),
        totalReports,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
        sentToday: !!sentToday,
        reports: formattedReports
      }
    });

  } catch (error) {
    console.error('[GET REPORTS ERROR]', error);
    return sendError(res, 500, 'Internal server error');
  }
};

const deleteReportByAdmin = async (req, res) => {
  try {
    const { role, companyId } = req.user;
    const { id: reportId } = req.params;

    if (role !== 'admin') {
      return sendError(res, 403, '🚫 فقط المدير يمكنه حذف التقارير');
    }

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return sendError(res, 400, '📛 معرف التقرير غير صالح');
    }

    const deletedReport = await DailyReport.findOneAndDelete({
      _id: reportId,
      companyId
    });

    if (!deletedReport) {
      return sendError(res, 404, '❌ التقرير غير موجود أو لا ينتمي لشركتك');
    }

    return sendSuccess(res, 200, '✅ تم حذف التقرير بنجاح', {
      deletedReport: {
        id: deletedReport._id,
        date: deletedReport.date
      }
    });

  } catch (error) {
    console.error('❌ Error in deleteReportByAdmin:', {
      error: error.message,
      reportId: req.params.id,
      user: req.user.userId
    });
    return sendError(res, 500, '❌ خطأ في الخادم الداخلي');
  }
};

const getReportsStats = async (req, res) => {
  try {
    const { companyId } = req.user;
    const today = now().format('YYYY-MM-DD');

    const [totalSalesReps, activeRepsCount, visitsResult] = await Promise.all([
      User.countDocuments({
        companyId,
        role: 'sales',
        isActive: true
      }),

      DailyReport.countDocuments({
        companyId,
        date: today
      }),

      DailyReport.aggregate([
        {
          $match: {
            companyId: new mongoose.Types.ObjectId(companyId),
            date: today
          }
        },
        {
          $project: {
            visitedCount: {
              $size: {
                $filter: {
                  input: "$visits",
                  as: "visit",
                  cond: { $eq: ["$$visit.status", "visited"] }
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalCompletedVisits: { $sum: "$visitedCount" }
          }
        }
      ])
    ]);

    return res.status(200).json({
      success: true,
      data: {
        date: today,
        totalSalesReps,
        activeRepsCount,
        totalCompletedVisits: visitsResult[0]?.totalCompletedVisits || 0
      }
    });

  } catch (error) {
    console.error('[STATS ERROR]', error);
    return sendError(res, 500, 'Internal server error');
  }
};

module.exports = {
  createOrUpdateReport,
  deleteReportByAdmin,
  getReports,
  getReportsStats,
  getSingleReport
};