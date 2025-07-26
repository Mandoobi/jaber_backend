const express = require('express');
const router = express.Router();
const protect = require('../../middleware/authMiddleware');
const authorizeRoles = require('../../middleware/authorizeRoles');
const checkCompanyOwnership = require('../../middleware/checkCompanyOwnership');

const {
  createOrder,
  getOrderById,
  updateOrder,
  deleteOrder,
  deleteAllOrders,
  getAllOrders
} = require('../controllers/orderController');
const Order = require('./Order');

router.post('/',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), createOrder);
router.get('/',protect, authorizeRoles('owner', 'admin', 'sales','preparer'), getAllOrders);
router.get('/:id',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), getOrderById);
router.put('/:id',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(Order), updateOrder);
router.delete('/:id',protect, authorizeRoles('owner', 'admin', 'sales', 'preparer'), checkCompanyOwnership(Order), deleteOrder);
router.delete('/',protect, authorizeRoles('owner'), checkCompanyOwnership(Order), deleteAllOrders);



module.exports = router;
