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
  getCustomerStats
} = require('../controllers/customerController');
const Customer = require('../models/Customer');


router.use(protect, blockDeletedUsers, checkSubscriptionStatus); // 🔥 تعمل لكل الراوترات بعده

router.post('/', protect, authorizeRoles('admin', 'sales'), checkPermission('add_customers'), createCustomer);

// 👀 عرض كل العملاء (بدون حماية إذا بدك تخليها عامة)
router.get('/', protect, authorizeRoles('admin', 'sales'), getAllCustomers);

router.get('/stats', protect, authorizeRoles('admin', 'sales'), getCustomerStats);
// 👀 عرض عميل واحد
router.get('/:id', protect, authorizeRoles('admin', 'sales'), getCustomerById);

// ✏️ تعديل عميل
router.put('/:id', protect, authorizeRoles('admin', 'sales'), checkCompanyOwnership(Customer), checkPermission('edit_customers'), updateCustomer);

// 🗑️ حذف عميل
router.delete('/:id', protect, authorizeRoles('admin', 'sales'), checkCompanyOwnership(Customer), checkPermission('delete_customers'), deleteCustomer);

module.exports = router;
