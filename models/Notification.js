const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  level: {
    type: String,
    enum: ['info', 'warning', 'error', 'success'],
    default: 'info'
  },
  actionType: {
    type: String,
    enum: [
      'add_customer',
      'delete_customer',
      'edit_customer',
      'add_visit_line',
      'update_visit_line',
      'update_profile',
      'login_success',
      'rep_login',
      'send_daily_report',
      'missed_daily_report',
      'reminder_to_send_report',
    ],
    required: true
  },
  description: { type: String, required: true },
  relatedEntity: {
    entityType: { type: String },
    entityId: { type: mongoose.Schema.Types.ObjectId }
  },
  previousData: { type: mongoose.Schema.Types.Mixed },

  // 🆕 الحقل الجديد
  changes: { type: mongoose.Schema.Types.Mixed, default: null },

  seen: { type: Boolean, default: false },
  seenAt: {
    type: Date,
    default: null,
  },

  sent: { type: Boolean, default: false },
  sentAt: { type: Date },
  sendError: { type: String },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
