const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');


router.use(protect, blockDeletedUsers, checkSubscriptionStatus); // 🔥 تعمل لكل الراوترات بعده

router.get('/report/:id', authorizeRoles('admin', 'sales'), exportController.exportDailyReportById);

module.exports = router;
