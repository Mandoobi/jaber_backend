// middleware/authorizeRoles.js
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {

      return res.status(403).json({
       message: `❌ Access denied: Allowed roles → [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
};

module.exports = authorizeRoles;
