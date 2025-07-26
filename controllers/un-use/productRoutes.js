const express = require('express');
const router = express.Router();
const protect = require('../../middleware/authMiddleware');
const authorizeRoles = require('../../middleware/authorizeRoles');
const checkCompanyOwnership = require('../../middleware/checkCompanyOwnership');

const {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const Product = require('../../models/Product');

// المسارات
router.post('/',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), createProduct);          // إنشاء منتج

router.get('/',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), getAllProducts);          // كل المنتجات

router.get('/:id',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), getProductById);       // منتج محدد

router.put('/:id',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(Product), updateProduct);        // تحديث منتج

router.delete('/:id',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(Product), deleteProduct);     // حذف منتج

module.exports = router;
