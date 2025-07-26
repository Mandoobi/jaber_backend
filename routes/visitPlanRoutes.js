const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');
const checkPermission = require('../middleware/checkPermission');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

const {
  createOrUpdateVisitPlan,
  getVisitPlan,
  deleteVisitPlanDay,
  getTodayVisitPlan
} = require('../controllers/visitPlanController');

// إنشاء أو تحديث خطة زيارات
router.post(
  '/',
  protect,
  authorizeRoles('sales', 'admin'),
  checkPermission('create_edit_visit_day'),
  createOrUpdateVisitPlan
);

// جلب خطة زيارات (مع إمكانية فلترة اليوم والمندوب)
router.get(
  '/',
  protect,
  authorizeRoles('sales', 'admin'),
  getVisitPlan
);

router.get(
  '/today-visit-plan',
  protect,
  authorizeRoles('sales'),
  getTodayVisitPlan
);

// حذف يوم من خطة زيارات (للمندوب)
router.delete(
  '/day/:dayName',
  protect,
  authorizeRoles('sales'),
  deleteVisitPlanDay
);

// حذف يوم من خطة مندوب (للأدمن)
router.delete(
  '/:repId/day/:dayName',
  protect,
  authorizeRoles('admin'),
  deleteVisitPlanDay
);

module.exports = router;
