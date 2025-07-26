const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

const {createOrUpdateReport, deleteReportByAdmin, getReports, getReportsStats, getSingleReport} = require('../controllers/dailyReportController');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

// إنشاء تقرير اليوم (لمندوبي المبيعات فقط)
router.post('/', 
  protect,
  authorizeRoles('sales', 'admin'),
  createOrUpdateReport
);

// حذف تقرير (للادمن فقط)
router.delete(
  '/:id',
  authorizeRoles('admin'),
  deleteReportByAdmin
);

// جلب التقارير (حسب صلاحيات المستخدم: الادمن والمندوب)
router.get(
  '/',
  authorizeRoles('admin', 'sales'),
  getReports
);

router.get(
  '/stats',
  authorizeRoles('admin', 'sales'),
  getReportsStats
);

router.get(
  '/:id',
  authorizeRoles('admin', 'sales'),
  getSingleReport
);

module.exports = router;
