const mongoose = require('mongoose');

const loginLogSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'preparer', 'sales'],
    required: true
  },
  ipAddress: String,
  location: String, // city, region, country مثلاً
  loginStatus: {
    type: String,
    enum: ['success', 'failed'],
    required: true
  },
  failureReason: String,
  token: String,
  tokenExpiresAt: Date,
  tokenIsActive: {
    type: Boolean,
    default: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('LoginLog', loginLogSchema);
