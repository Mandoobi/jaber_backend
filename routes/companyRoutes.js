const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const protect = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/authorizeRoles');

router.post('/', protect, authorizeRoles('owner'), companyController.createCompany);

router.get('/', protect, authorizeRoles('owner'), companyController.getCompanies);

router.get('/:id', protect, authorizeRoles('owner'), companyController.getCompanyById);

router.put('/:id', protect, authorizeRoles('owner'), companyController.updateCompany);

module.exports = router;
