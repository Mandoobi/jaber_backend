const jwt = require('jsonwebtoken');
const LoginLog = require('../models/LoginLog');
const User = require('../models/User');

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization?.split(' ');

  if (!authHeader || authHeader[0] !== 'Bearer' || !authHeader[1]) {
    return res.status(401).json({ message: '❌ Unauthorized: No token provided' });
  }

  const token = authHeader[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // ✅ هذا السطر هو المفتاح
    req.token = token;

    // تأكد إن التوكن لسه فعال
    const tokenRecord = await LoginLog.findOne({ token, tokenIsActive: true });
    if (!tokenRecord) {
      return res.status(401).json({ message: '❌ Unauthorized: Token invalidated (logged out)' });
    }

    // جلب المستخدم من قاعدة البيانات
    const user = await User.findById(decoded.userId);

    if (!user) {
      req.user = {
        userId: decoded.userId,
        role: decoded.role || null,
        companyId: decoded.company || null,
        deleted: true,
      };
    } else {
      if (!user.isActive) {
        return res.status(401).json({ message: '❌ المستخدم غير نشط' });
      }

      req.user = {
        userId: user._id.toString(),
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        companyId: user.companyId?.toString() || null,
        isActive: user.isActive,
        deleted: false,
      };
    }

    next();
  } catch (err) {
    console.log('❌ Token verify error:', err.message);
    return res.status(401).json({ message: '❌ Unauthorized: Invalid token', error: err.message });
  }
};

module.exports = protect;
