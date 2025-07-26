const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const protect = require('../middleware/authMiddleware');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

// حماية جميع الراوترات بعده
router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

// إضافة ملاحظة جديدة
router.post('/', feedbackController.submitFeedback);

// جلب كل الملاحظات (مثلاً للإدارة، ممكن تضيف authorizeRoles إذا بدك تقيده)
router.get('/', feedbackController.getAllFeedbacks);

module.exports = router;
