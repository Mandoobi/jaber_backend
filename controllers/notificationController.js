const Notification = require('../models/Notification');
const { now } = require('../utils/dayjs');

const getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const totalNotifications = await Notification.countDocuments({ targetUsers: userId });
    const totalPages = Math.ceil(totalNotifications / limit);

    const notifications = await Notification.find({ targetUsers: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const unseenNotificationIds = notifications
      .filter(n => !n.seen)
      .map(n => n._id);

    // ✅ أرسل الرد أولًا
    res.status(200).json({
      notifications,
      totalNotifications,
      totalPages,
      currentPage: page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    });

    // ✅ التحديث في الخلفية بدون لمس الرد
    if (unseenNotificationIds.length > 0) {
      try {
        await Notification.updateMany(
          { _id: { $in: unseenNotificationIds } },
          {
            $set: {
              seen: true,
              seenAt: now().toDate()
            }
          }
        );
      } catch (updateError) {
        console.error('❌ Failed to update seen notifications:', updateError.message);
        // ما تعملش res.json هون نهائيًا
      }
    }

  } catch (error) {
    // هذا فقط لو صار خطأ قبل إرسال الرد
    res.status(500).json({ message: '❌ خطأ في جلب الإشعارات' });
  }
};



module.exports = {
  getNotifications
};
