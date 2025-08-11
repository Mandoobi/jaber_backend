const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { now, parseWithTZ } = require('../utils/dayjs');
const LoginLog = require('../models/LoginLog');
const getLocation = require('../utils/getLocation');
const Notification = require('../models/Notification');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '14d'; // Default 14 days

function cleanIp(ip) {
  if (!ip) return null;
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
  return ip;
}

const getAdmins = async (companyId, excludeUserId = null) => {
  const query = { companyId, role: 'admin' };
  const admins = await User.find(query, '_id');
  
  let adminIds = admins.map(admin => admin._id.toString());
  
  if (excludeUserId) {
    adminIds = adminIds.filter(id => id !== excludeUserId.toString());
  }
  
  return adminIds;
};

const loginUser = async (req, res) => {
  const { username, password } = req.body;
  const ipAddressRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ipAddress = cleanIp(ipAddressRaw);
  const userAgent = req.headers['user-agent'];
  const timestamp = now().toDate();
  const allUsers = await User.find({});
  try {
    const user = await User.findOne({ username });
    if (!user) {

      return res.status(401).json({ message: '❌ المستخدم غير موجود' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: '🚫 تم تعطيل حسابك مؤقتًا، تواصل مع المسؤول' });
    }

    const isMatch = await user.comparePassword(password);
    const loginStatus = isMatch ? 'success' : 'failed';
    const failureReason = isMatch ? undefined : 'Incorrect password';
    let token = null;

    if (isMatch) {
      token = jwt.sign(
        { userId: user._id, company: user.companyId, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
    }

    const locationObj = await getLocation(ipAddress);
    const locationString = JSON.stringify(locationObj);

    // Create login log
    await LoginLog.create({
      companyId: user.companyId,
      userId: user._id,
      role: user.role,
      loginStatus,
      ipAddress,
      userAgent,
      timestamp,
      failureReason,
      token,
      tokenExpiresAt: token ? now().add(14, 'day').toDate() : undefined,
      tokenIsActive: !!token,
      location: locationString,
    });

    if (loginStatus !== 'success') {
      return res.status(401).json({ message: '❌ كلمة السر غير صحيحة' });
    }

    // Notification handling
    const userNotificationDelay = now().subtract(3, 'minute').toDate();
    const adminNotificationDelay = now().subtract(10, 'minute').toDate();

    // User notification
    const recentUserNotification = await Notification.findOne({
      userId: user._id,
      actionType: 'login_success',
      createdAt: { $gte: userNotificationDelay }
    });

    if (!recentUserNotification) {
      await Notification.create({
        userId: user._id,
        targetUsers: [user._id],
        actionType: 'login_success',
        level: 'warning',
        description: `🚨 تم تسجيل الدخول إلى حسابك من جهاز أو موقع جديد`,
        meta: { ipAddress, userAgent, timestamp },
        relatedEntity: { entityType: 'User', entityId: user._id },
      });
    }

    // Admin notification
    const adminIds = await getAdmins(user.companyId, user._id);
    if (adminIds.length > 0) {
      const recentAdminNotification = await Notification.findOne({
        targetUsers: { $in: adminIds },
        actionType: 'rep_login',
        createdAt: { $gte: adminNotificationDelay }
      });

      if (!recentAdminNotification) {
        await Notification.create({
          userId: user._id,
          targetUsers: adminIds,
          actionType: 'rep_login',
          level: 'info',
          description: `✅ المندوب ${user.fullName} قام بتسجيل الدخول`,
          meta: { ipAddress, userAgent, timestamp },
          relatedEntity: { entityType: 'User', entityId: user._id },
        });
      }
    }

    return res.status(200).json({
      message: '✅ تم تسجيل الدخول بنجاح',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        companyId: user.companyId,
      },
    });

  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({ message: '❌ خطأ في تسجيل الدخول', error: error.message });
  }
};

const getLastLogin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    const lastLogin = await LoginLog.findOne({
      userId,
      loginStatus: 'success',
      _id: { $ne: req.user.loginLogId } // Exclude current session
    })
    .sort({ timestamp: -1 })
    .select('ipAddress location timestamp userAgent');

    if (!lastLogin) {
      return res.status(404).json({ message: '❌ لا يوجد تسجيل دخول سابق' });
    }

    return res.status(200).json({
      message: '✅ آخر تسجيل دخول تم العثور عليه',
      accountCreatedAt: user.createdAt,
      lastLogin
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '❌ خطأ في جلب آخر تسجيل دخول', error: error.message });
  }
};

const getAllActiveSessions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentToken = req.token;

    const activeSessions = await LoginLog.find({ 
      userId, 
      tokenIsActive: true,
      tokenExpiresAt: { $gt: now().toDate() } // Using your custom now()
    })
    .sort({ timestamp: -1 })
    .select('ipAddress userAgent timestamp loginStatus token location');

    const sessionsWithFlag = activeSessions.map(session => ({
      ...session.toObject(),
      isCurrentSession: session.token === currentToken,
      isExpired: now().isAfter(parseWithTZ(session.tokenExpiresAt)) // Using parseWithTZ instead of dayjs()
    }));

    res.status(200).json({
      message: '✅ تم جلب الجلسات النشطة',
      totalActiveSessions: sessionsWithFlag.filter(s => !s.isExpired).length,
      sessions: sessionsWithFlag
    });

  } catch (error) {
    res.status(500).json({ message: '❌ خطأ في جلب الجلسات النشطة', error: error.message });
  }
};

const logoutSpecificSession = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: '❌ يلزم توكن الجلسة' });
    }

    const session = await LoginLog.findOneAndUpdate(
      { userId, token, tokenIsActive: true },
      { tokenIsActive: false },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ message: '❌ الجلسة غير موجودة أو مسجلة خروج بالفعل' });
    }

    res.status(200).json({ message: '✅ تم تسجيل الخروج من الجلسة المحددة بنجاح' });
  } catch (error) {
    res.status(500).json({ message: '❌ خطأ أثناء تسجيل الخروج من الجلسة', error: error.message });
  }
};

const logoutUser = async (req, res) => {
  try {
    await LoginLog.findOneAndUpdate(
      { token: req.token, tokenIsActive: true },
      { tokenIsActive: false }
    );

    res.status(200).json({ 
      message: `✅ تم تسجيل الخروج بنجاح ${req.user.fullName}` 
    });
  } catch (error) {
    res.status(500).json({ message: '❌ خطأ أثناء تسجيل الخروج', error: error.message });
  }
};

const verifyPassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    // بافتراض إن req.user موجود من middleware الـ JWT
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: 'كلمة مرور غير صحيحة!' });
    }

    // لو كلشي تمام
    return res.status(200).json({ success: true, message: 'كلمة مرور صحيحة!' });

  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

const logoutAllSessions = async (req, res) => {
  try {
    const result = await LoginLog.updateMany(
      { 
        userId: req.user.userId, 
        tokenIsActive: true 
      },
      { tokenIsActive: false }
    );

    res.status(200).json({
      message: '✅ تم تسجيل الخروج من جميع الجلسات بنجاح',
      loggedOutSessions: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ message: '❌ خطأ أثناء تسجيل الخروج من جميع الجلسات', error: error.message });
  }
};

const forceLogoutUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '❌ فقط الأدمن يمكنه تنفيذ هذا الطلب' });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '❌ يلزم معرف المستخدم' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: '❌ المستخدم غير موجود' });
    }

    const result = await LoginLog.updateMany(
      { userId, tokenIsActive: true },
      { tokenIsActive: false }
    );

    res.status(200).json({
      message: `✅ تم تسجيل خروج جميع جلسات المستخدم ${user.fullName} بنجاح`,
      affectedSessions: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ message: '❌ فشل تسجيل الخروج الإجباري', error: error.message });
  }
};

module.exports = { 
  loginUser, 
  logoutUser, 
  forceLogoutUser, 
  getLastLogin, 
  verifyPassword,
  logoutAllSessions, 
  getAllActiveSessions, 
  logoutSpecificSession 
};