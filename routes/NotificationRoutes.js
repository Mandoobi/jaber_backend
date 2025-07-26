const express = require('express');
const router = express.Router();
const { getNotifications } = require('../controllers/notificationController');
const protect = require('../middleware/authMiddleware');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const authorizeRoles = require('../middleware/authorizeRoles');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

router.get('/', getNotifications, authorizeRoles('sales', 'admin'));

module.exports = router;
