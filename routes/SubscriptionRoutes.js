const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const authorizeRoles = require('../middleware/authorizeRoles');

const {
  createSubscription,
  getCurrentSubscription
} = require('../controllers/SubscriptionController');

router.use(protect, blockDeletedUsers);

// إنشاء اشتراك جديد
router.post('/', authorizeRoles('owner'), createSubscription);


router.get('/current/', authorizeRoles('admin'), getCurrentSubscription);

module.exports = router;
