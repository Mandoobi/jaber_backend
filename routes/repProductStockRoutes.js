const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

const {
  getMyStocks,
  getProductStocksByReps,
  updateRepProductStock
} = require('../controllers/repProductStockController');

// 🛡️ حماية كل الراوتات
router.use(protect, blockDeletedUsers, checkSubscriptionStatus);

// 📦 المندوب يجيب كل كميات المنتجات الخاصة فيه
router.get('/my-stocks', authorizeRoles('sales'), getMyStocks);

// 📦 الادمن يجيب كميات كل المندوبين لمنتج محدد (باراميتر productId)
router.get('/product/:productId', authorizeRoles('admin'), getProductStocksByReps);

// 🔄 تحديث كمية منتج لمندوب معين (للادمن فقط)
router.put('/', authorizeRoles('admin'), updateRepProductStock);

module.exports = router;
