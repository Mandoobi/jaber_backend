const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    unitType: {
      type: String,
      enum: ['كرتونة', 'علبة', 'حبة', 'ربطة'],
      required: true
    },
    weight: { type: Number },
    weightUnit: {
      type: String,
      enum: ['كيلو', 'جرام', 'مليلتر', 'لتر'],
      required: function () {
        return this.weight !== undefined;
      }
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);