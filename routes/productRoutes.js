const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const checkCompanyOwnership = require('../middleware/checkCompanyOwnership');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');

const {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const Product = require('../models/Product');

router.use(protect, blockDeletedUsers, checkSubscriptionStatus); // 🔥 تعمل لكل الراوترات بعده

// المسارات
router.post('/',authorizeRoles('owner', 'admin', 'sales', 'preparer'), createProduct);          // إنشاء منتج

router.get('/',authorizeRoles('owner', 'admin', 'sales', 'preparer'), getAllProducts);          // كل المنتجات

router.get('/:id',authorizeRoles('owner', 'admin', 'sales', 'preparer'), getProductById);       // منتج محدد

router.put('/:id',authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(Product), updateProduct);        // تحديث منتج

router.delete('/:id',authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(Product), deleteProduct);     // حذف منتج

module.exports = router;
