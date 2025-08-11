const { Schema, model, Types } = require('mongoose');

const repProductStockSchema = new Schema({
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
  quantity: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// تأكد من وجود index على الثلاث حقول عشان تسريع البحث
repProductStockSchema.index({ companyId: 1, repId: 1, productId: 1 }, { unique: true });

module.exports = model('RepProductStock', repProductStockSchema);
