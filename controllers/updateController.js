const semver = require('semver');
const Update = require('../models/Update');
const User = require('../models/User');

  // ✅ جلب آخر تحديث مهم (Critical) غير مشاهد من قبل المستخدم
const getUserUpdates = async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ message: '❌ المستخدم غير موجود' });

      const lastSeen = user.lastSeenUpdate || null;

      // فقط التحديثات المهمة والمرتبطة بالدور
      const updates = await Update.find({
        roles: user.role,
        isCritical: true
      }).sort({ date: 1 });

      // تصفية التحديثات التي نسختها أحدث من النسخة التي شاهدها المستخدم
      const unseenUpdates = lastSeen
        ? updates.filter(u => semver.gt(u.version, lastSeen))
        : updates;

      // نأخذ أحدث واحد فقط
      const latestUpdate = unseenUpdates.sort((a, b) => semver.rcompare(a.version, b.version))[0];

      // نرجع فقط إذا في تحديث مهم غير مشاهد
      res.json(latestUpdate ? [latestUpdate] : []);
    } catch (err) {
      res.status(500).json({ message: '❌ خطأ في جلب التحديثات', error: err.message });
    }
};

const getLastUpdate = async (req, res) => {
    try {
      const latest = await Update.findOne().sort({ date: -1 });
      res.json(
        {version: latest.version,
          title: latest.title,
          date: latest.date} || {});
    } catch (err) {
      res.status(500).json({ message: '❌ خطأ في جلب آخر تحديث', error: err.message });
    }
};

  // 👇 يعرض كل التحديثات الخاصة برتبة المستخدم
const getAllUpdatesForTab = async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ message: '❌ المستخدم غير موجود' });

      // خذ قيمة limit من query أو خليها 10 بشكل افتراضي
      const limit = parseInt(req.query.limit) || 10;

      const updates = await Update.find({ roles: user.role })
        .sort({ date: -1 })
        .limit(limit);

      res.json(updates);
    } catch (err) {
      res.status(500).json({ message: '❌ خطأ في جلب التحديثات', error: err.message });
    }
};

  // ✅ تحديث أن المستخدم شاهد آخر تحديث
const markUpdateAsSeen = async (req, res) => {
    try {
      const { updateVersion } = req.body;

      if (!updateVersion) {
        return res.status(400).json({ message: '❌ يجب إرسال نسخة التحديث' });
      }

      // تحقق أن النسخة المرسلة صحيحة من ناحية صيغة semantic version
      if (!semver.valid(updateVersion)) {
        return res.status(400).json({ message: '❌ نسخة التحديث غير صالحة' });
      }

      const result = await User.updateOne(
        { _id: req.user.userId },
        { $set: { lastSeenUpdate: updateVersion } }
      );

      console.log("✏️ Update Result:", result);

      if (result.modifiedCount === 0) {
        return res.status(400).json({ message: '⚠️ لم يتم تعديل أي شيء. ربما القيمة نفسها؟' });
      }

      res.json({ message: '✅ تم تسجيل مشاهدة التحديث' });
    } catch (err) {
      console.error('❌ Error in markUpdateAsSeen:', err);
      res.status(500).json({ message: '❌ خطأ أثناء تحديث حالة المشاهدة', error: err.message });
    }
};

module.exports = {
    getUserUpdates,
    markUpdateAsSeen,
    getAllUpdatesForTab,
    getLastUpdate
};
