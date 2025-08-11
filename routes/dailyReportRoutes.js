const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

const {
  createOrUpdateReport,
  deleteReportByAdmin,
  getReports,
  getReportsStats,
  getSingleReport
} = require('../controllers/dailyReportController');

const { upload } = require('../config/cloudinary'); // ✅ هيك صح

// 🛡️ حماية كل الراوتات
router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

// ✅ تعديل الراوت ليدعم رفع الصور
router.post(
  '/',
  authorizeRoles('admin', 'sales'),
  upload.array('images', 3), // لرفع حتى ٣ صور
  createOrUpdateReport
);

// باقي الراوتات
router.delete('/:id', authorizeRoles('admin'), deleteReportByAdmin);
router.get('/', authorizeRoles('admin', 'sales'), getReports);
router.get('/stats', authorizeRoles('admin', 'sales'), getReportsStats);
router.get('/:id', authorizeRoles('admin', 'sales'), getSingleReport);

module.exports = router;
