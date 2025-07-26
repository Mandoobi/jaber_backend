const User = require('../models/User');

const authorizePermissions = (...requiredPermissions) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized - user not found' });
      }

      // 👑 If user is admin, skip permission check
      if (req.user.role === 'admin') {
        return next();
      }

      // 🔐 Check required permissions
      const hasPermission = requiredPermissions.every((perm) => {
        return user.permissions.includes(perm);
      });

      if (!hasPermission) {
        return res.status(403).json({ message: 'Access Denied - insufficient permissions' });
      }

      next();
    } catch (err) {
      res.status(500).json({ message: 'Server error in permissions check', error: err.message });
    }
  };
};

module.exports = authorizePermissions;
