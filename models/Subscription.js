const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  tier: {
    type: String,
    enum: ['free', 'basic', 'pro'],
    default: 'free'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  maxUsers: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'suspended'],
    default: 'active'
  },
  isCancelled: {
    type: Boolean,
    default: false
  },
  cancelReason: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});



module.exports = mongoose.model('Subscription', subscriptionSchema);
