// routes/permissionRoutes.js
const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const authorizeRoles = require('../middleware/authorizeRoles');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');
const {createPermission, getAllPermissions} = require('../controllers/PermissionController');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

router.post('/', authorizeRoles('admin'), createPermission);
router.get('/all', authorizeRoles('admin'), getAllPermissions);

module.exports = router;
