const { Schema, model, Types } = require('mongoose');

const sampleSchema = new Schema({
  companyId: {
    type: Types.ObjectId,
    ref: 'Company',
    required: true
  },
  takenBy: {
    type: Types.ObjectId,
    ref: 'User',
    required: true
  },
  productId: {
    type: Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  type: {
    type: String,
    enum: ['customer', 'personal'],
    required: true
  },
  customerId: {
    type: Types.ObjectId,
    ref: 'Customer'
  },
  reportId: {
    type: Types.ObjectId,
    ref: 'DailyReport'
  },
  visitId: {
    type: Types.ObjectId,
    ref: 'Visit'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

sampleSchema.index({ companyId: 1, takenBy: 1, productId: 1, createdAt: -1 });

module.exports = model('Sample', sampleSchema);
