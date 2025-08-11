const express = require('express');
const router = express.Router();

// 🛡️ لازم تستورد الـ middleware لحماية الرّاوتر
const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');
const checkCompanyOwnership = require('../middleware/checkCompanyOwnership');
const blockDeletedUsers = require('../middleware/blockDeletedUsers');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');
const checkPermission = require('../middleware/checkPermission');

const {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerStats,
  getCustomerAssignments
} = require('../controllers/customerController');
const Customer = require('../models/Customer');


router.use(protect, blockDeletedUsers, checkSubscriptionStatus); // 🔥 تعمل لكل الراوترات بعده

router.post('/', authorizeRoles('admin', 'sales'), checkPermission('add_customers'), createCustomer);

router.get('/', authorizeRoles('admin', 'sales'), getAllCustomers);

router.get('/customer-assignments', authorizeRoles('admin', 'sales'), getCustomerAssignments);

router.get('/stats', authorizeRoles('admin', 'sales'), getCustomerStats);
// 👀 عرض عميل واحد
router.get('/:id', authorizeRoles('admin', 'sales'), getCustomerById);

// ✏️ تعديل عميل
router.put('/:id', authorizeRoles('admin', 'sales'), checkCompanyOwnership(Customer), checkPermission('edit_customers'), updateCustomer);

// 🗑️ حذف عميل
router.delete('/:id', authorizeRoles('admin', 'sales'), checkCompanyOwnership(Customer), checkPermission('delete_customers'), deleteCustomer);

module.exports = router;
