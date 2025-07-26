const User = require('../models/User');
const Company = require('../models/Company');
const LoginLog = require('../models/LoginLog.js');
const { now } = require('../utils/dayjs');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Subscription = require('../models/Subscription');
const Update = require('../models/Update'); // تأكد إنه موجود بأعلى الملف
const ALLOWED_ROLES = ['owner', 'admin', 'sales'];

// التحقق من الحقول المطلوبة
const validateUserFields = ({ fullName, username, password, phone, companyId, role }) => {
  return fullName && username && password && phone && companyId && role;
};

// التحقق من الرتبة
const isValidRole = (role) => ALLOWED_ROLES.includes(role);

const getAdmins = async (companyId, excludeUserId = null) => {
  let query = { companyId, role: 'admin' };
  let admins = await User.find(query, '_id');

  let adminIds = admins.map(admin => admin._id.toString());

  if (excludeUserId) {
    adminIds = adminIds.filter(id => id !== excludeUserId.toString());
  }

  return adminIds;
};

// In userController.js
const getUserStats = async (req, res) => {
  try {
    const { companyId } = req.user;

    // Single optimized aggregation
    const stats = await User.aggregate([
      {
        $match: { companyId: new mongoose.Types.ObjectId(companyId) }
      },
      {
        $group: {
          _id: null,
          totalReps: { 
            $sum: { $cond: [{ $eq: ["$role", "sales"] }, 1, 0] } 
          },
          totalAdmins: { 
            $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } 
          },
          repIds: {
            $push: {
              $cond: [
                { $eq: ["$role", "sales"] },
                "$_id",
                "$$REMOVE"
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "dailyreports",
          let: { companyId: new mongoose.Types.ObjectId(companyId) },
          pipeline: [
            { 
              $match: { 
                $expr: { 
                  $and: [
                    { $eq: ["$companyId", new mongoose.Types.ObjectId(companyId)] },
                    { $ifNull: ["$visits", false] }
                  ]
                } 
              } 
            },
            { $unwind: "$visits" },
            { 
              $group: { 
                _id: "$repId", 
                visits: { $sum: 1 } 
              } 
            },
            { 
              $group: { 
                _id: null, 
                avg: { $avg: "$visits" } 
              } 
            }
          ],
          as: "avgVisits"
        }
      },
      {
        $project: {
          _id: 0,
          totalReps: 1,
          totalAdmins: 1,
          avgVisitsPerRep: {
            $round: [
              { $ifNull: [{ $arrayElemAt: ["$avgVisits.avg", 0] }, 0] },
              0
            ]
          }
        }
      }
    ]);

    res.json(stats[0] || { totalReps: 0, avgVisitsPerRep: 0, totalAdmins: 0 });

  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).json({ message: "Error fetching user stats", error: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    // 1. First validate simple fields (no DB calls)
    const { fullName, username, password, phone, email, role, isActive, permissions } = req.body;
    const companyId = req.user.companyId;

    if (!validateUserFields({ fullName, username, password, phone, companyId, role })) {
      return res.status(400).json({ message: '❌ جميع الحقول المطلوبة يجب تعبئتها' });
    }

    if (!isValidRole(role)) {
      return res.status(400).json({ message: '❌ الرتبة غير صالحة' });
    }

    // 2. Parallelize all database operations
    const [companyExists, subscription, activeUserCount, lastUpdate] = await Promise.all([
      Company.findById(companyId).select('_id').lean(),
      Subscription.findOne({ 
        companyId, 
        status: 'active',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() }
      }).select('maxUsers').lean(),
      User.countDocuments({ companyId, isActive: true }),
      Update.findOne().sort({ date: -1 }).select('version').lean()
    ]);

    // 3. Validate after queries
    if (!companyExists) {
      return res.status(400).json({ message: '❌ الشركة غير موجودة أو المعرف غير صحيح' });
    }

    if (!subscription) {
      return res.status(403).json({ message: '❌ لا يوجد اشتراك نشط للشركة' });
    }

    if (activeUserCount >= subscription.maxUsers) {
      return res.status(403).json({ 
        message: `❌ لقد وصلت إلى الحد الأقصى للمستخدمين (${subscription.maxUsers})`,
        suggestion: 'يمكنك ترقية اشتراكك أو تعطيل مستخدمين غير نشطين'
      });
    }

    // 4. Create user (without waiting for visit plan)
    const newUser = new User({
      fullName,
      username,
      password,
      phone,
      email,
      companyId,
      role,
      isActive,
      permissions: permissions || [], // Add this line to include permissions
      lastSeenUpdate: lastUpdate?.version || null
    });

    const savedUser = await newUser.save();

    // 5. Handle visit plan in background (non-blocking)
    if (savedUser.role === 'sales') {
      createVisitPlanForSales(savedUser._id, companyId);
    }

    res.status(201).json({
      message: '✅ تم إنشاء المستخدم بنجاح',
      user: savedUser
    });

  } catch (error) {
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: '❌ خطأ في التحقق من البيانات',
        errors 
      });
    }

    // Handle duplicate key errors (like unique username)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        message: `❌ ${field} موجود مسبقاً في النظام` 
      });
    }

    // Handle other unexpected errors
    console.error('Error creating user:', error);
    res.status(500).json({ 
      message: '❌ حدث خطأ غير متوقع أثناء إنشاء المستخدم',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Move visit plan creation to separate function
async function createVisitPlanForSales(userId, companyId) {
  try {
    const VisitPlan = require('../models/VisitPlan');
    const existingPlan = await VisitPlan.findOne({ repId: userId, companyId });
    
    if (!existingPlan) {
      await VisitPlan.create({
        repId: userId,
        companyId,
        days: Array(7).fill().map((_, i) => ({
          day: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i],
          customers: []
        }))
      });
    }
  } catch (err) {
    console.error('Error creating visit plan:', err);
  }
}

const getAllUsers = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const currentUserId = req.user.userId || req.user._id; // تأكد من اسم المفتاح عندك
    
    if (!companyId) {
      return res.status(401).json({ message: '❌ لا يوجد تعريف للشركة في التوكن (Unauthorized).' });
    }

    let { fullName, role, isActive, page, limit } = req.query;
    fullName = fullName?.trim();

    if (fullName && typeof fullName !== 'string') {
      return res.status(400).json({ message: '❌ fullName يجب أن يكون نصًا.' });
    }

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        message: `❌ قيمة role غير صالحة. القيم المسموح بها: ${ALLOWED_ROLES.join(', ')}`
      });
    }

    if (isActive !== undefined && isActive !== 'true' && isActive !== 'false') {
      return res.status(400).json({ message: '❌ isActive يجب أن يكون true أو false فقط.' });
    }

    let pageNumber = Number(page) || 1;
    if (pageNumber < 1) pageNumber = 1;

    let limitNumber = Number(limit) || 10;
    if (limitNumber > 50) limitNumber = 50;

    const query = {
      companyId,
      _id: { $ne: currentUserId } // **استثني المستخدم الحالي**
    };

    if (fullName) query.fullName = { $regex: fullName, $options: 'i' };
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const skip = (pageNumber - 1) * limitNumber;

    const [totalUsers, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query).skip(skip).limit(limitNumber).sort({ fullName: 1 }).lean()
    ]);

    // جلب آخر تسجيل دخول لكل مستخدم (كما في كودك)
    const userIds = users.map(u => u._id);

    const lastLogins = await LoginLog.aggregate([
      { $match: { userId: { $in: userIds }, loginStatus: 'success' } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$userId",
          lastLoginAt: { $first: "$timestamp" },
          ipAddress: { $first: "$ipAddress" }
        }
      }
    ]);

    const lastLoginMap = {};
    lastLogins.forEach(log => {
      lastLoginMap[log._id.toString()] = {
        lastLoginAt: log.lastLoginAt,
        ipAddress: log.ipAddress
      };
    });

    const enrichedUsers = users.map(user => {
      const extra = lastLoginMap[user._id.toString()] || {};
      return {
        ...user,
        lastLoginAt: extra.lastLoginAt || null,
        ipAddress: extra.ipAddress || null
      };
    });

    const totalPages = Math.max(1, Math.ceil(totalUsers / limitNumber));

    res.json({
      users: enrichedUsers,
      totalUsers,
      totalPages,
      currentPage: Math.min(pageNumber, totalPages)
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('💥 Error in getAllUsers:', error);
    }
    res.status(500).json({ message: '❌ خطأ داخلي في السيرفر عند جلب المستخدمين', error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const user = await User.findOne({ _id: req.params.id, companyId });
    if (!user) return res.status(404).json({ message: '❌ المستخدم غير موجود أو ليس من نفس الشركة' });

    res.status(200).json(user);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
    res.status(500).json({ message: '❌ خطأ في جلب المستخدم', error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.userId;
    const { password, role, ...rest } = req.body;

    if (role && !isValidRole(role)) {
      return res.status(400).json({ message: '❌ الرتبة غير صالحة' });
    }

    const user = await User.findOne({ _id: req.params.id, companyId });
    if (!user) {
      return res.status(404).json({ message: '❌ المستخدم غير موجود أو ليس من نفس الشركة' });
    }

    Object.assign(user, rest);
    if (password) {
      user.password = password; // التشفير تلقائي من الموديل عند .save()
    }
    if (role) user.role = role;
    user.updatedBy = userId;

    await user.save();

          // 🔔 إشعار للمدراء أنه تم تعديل الحساب
          // 🔔 إشعار للمدراء إذا ما تم إشعار خلال آخر 10 دقائق
      const adminIds = await getAdmins(companyId, userId);

      if (adminIds.length > 0) {
        const tenMinutesAgo = now().subtract(10, 'minute').toDate();

        const recentNotification = await Notification.findOne({
          userId,
          actionType: 'update_profile',
          createdAt: { $gte: tenMinutesAgo }
        });

        if (!recentNotification) {
          await Notification.create({
            userId,
            targetUsers: adminIds,
            actionType: 'update_profile',
            level: 'info',
            description: `👤 قام المستخدم ${user.fullName || user.username} بتحديث ملفه الشخصي`,
            relatedEntity: {
              entityType: 'User',
              entityId: user._id,
            },
          });
        }
      }

    res.status(200).json(user);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
    if (error.code === 11000 && error.keyPattern?.username) {
      return res.status(400).json({ message: `❌ اسم المستخدم "${error.keyValue.username}" موجود مسبقاً` });
    }
    console.log(error.message)
    res.status(500).json({ message: '❌ خطأ في تحديث المستخدم', error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userIdToDelete = req.params.id;
    const currentUserId = req.user.userId;

    if (userIdToDelete === currentUserId) {
      return res.status(400).json({ message: '❌ لا يمكنك حذف نفسك' });
    }

    const deletedUser = await User.findOneAndDelete({ _id: userIdToDelete, companyId });
    if (!deletedUser) {
      return res.status(404).json({ message: '❌ المستخدم غير موجود أو ليس من نفس الشركة' });
    }

    res.status(200).json({ message: '✅ تم حذف المستخدم بنجاح' });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
    res.status(500).json({ message: '❌ خطأ في حذف المستخدم', error: error.message });
  }
};

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserStats
};
