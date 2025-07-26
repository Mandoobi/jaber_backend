const express = require('express');
const router = express.Router();
const authorizeRoles = require('../middleware/authorizeRoles');
const protect = require('../middleware/authMiddleware');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

const { getAdminStats, getSalesStats } = require('../controllers/statsController')

router.use(protect, blockDeletedUsers, checkSubscriptionStatus); 


router.get('/admin', authorizeRoles('admin'), getAdminStats);
router.get('/sales', authorizeRoles('sales'), getSalesStats);

module.exports = router;
