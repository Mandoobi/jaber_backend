const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');
const { getUserUpdates, markUpdateAsSeen, getAllUpdatesForTab, getLastUpdate } = require('../controllers/updateController');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

router.get('/whats-new', authorizeRoles('admin', 'sales'), getUserUpdates);
router.patch('/whats-new/seen', authorizeRoles('admin', 'sales'), markUpdateAsSeen);
router.get('/whats-new/all', authorizeRoles('admin', 'sales'), getAllUpdatesForTab);
router.get('/whats-new/last', authorizeRoles('admin', 'sales'), getLastUpdate);

module.exports = router;