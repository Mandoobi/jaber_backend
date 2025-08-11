const { Schema, model, Types } = require('mongoose');

const repStockHistorySchema = new Schema({
  companyId: {
    type: Types.ObjectId,
    ref: 'Company',
    required: true
  },
  repId: {
    type: Types.ObjectId,
    ref: 'User',
    required: true
  },
  productId: {
    type: Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantityChange: {
    type: Number,
    required: true,
  },
  reason: {
    type: String,
    default: '',
    trim: true
  },
  addedBy: {
    type: Types.ObjectId,
    ref: 'User',
    required: true
  },
  includeInAnalysis: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// index لتحسين أداء الفلترة والتجميع
repStockHistorySchema.index({ companyId: 1, repId: 1, productId: 1, createdAt: -1 });

module.exports = model('RepStockHistory', repStockHistorySchema);
