const mongoose = require('mongoose');

const checkCompanyOwnership = (Model, companyField = 'companyId') => {
  return async (req, res, next) => {
    try {
      const resource = await Model.findById(req.params.id);
      if (!resource) {
        return res.status(404).json({ message: '🔍 Resource not found' });
      }

      if (resource[companyField].toString() !== req.user.companyId.toString()) {
        return res.status(403).json({ message: '❌ Access denied: Company mismatch' });
      }

      req.resource = resource;
      next();
    } catch (err) {
      res.status(500).json({ message: '❌ Server error', error: err.message });
    }
  };
};


module.exports = checkCompanyOwnership;
