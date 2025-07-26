const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const checkCompanyOwnership = require('../middleware/checkCompanyOwnership');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');
const User = require('../models/User'); // أو حسب مكان ملف الـ model عندك
const blockDeletedUsers = require('../middleware/blockDeletedUsers');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus); // 🔥 تعمل لكل الراوترات بعده
// إنشاء مستخدم جديد
router.post('/', protect, authorizeRoles('owner', 'admin'), userController.createUser);
// جلب كل المستخدمين
router.get('/', protect, authorizeRoles('owner', 'admin'), userController.getAllUsers);

router.get('/stats', protect, authorizeRoles('owner', 'admin'), userController.getUserStats);
// جلب مستخدم واحد
router.get('/:id', protect, authorizeRoles('owner', 'admin'), userController.getUserById);

// تحديث مستخدم
router.put('/:id', protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(User), userController.updateUser);

// حذف مستخدم
router.delete('/:id', protect, authorizeRoles('owner', 'admin'), checkCompanyOwnership(User), userController.deleteUser);

module.exports = router;
