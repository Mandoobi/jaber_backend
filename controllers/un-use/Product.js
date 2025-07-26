const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    price: { type: Number, required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    category: { type: String },
    unitType: { type: String, required: true }, // مثل: علبة، كرتونة، عبوة
    weight: { type: Number },
    weightUnit: {
      type: String,
      enum: ['kg', 'gm', 'ml', 'liter'],
      required: function () {
        return this.weight !== undefined;
      }
    },
    photoUrl: { type: String },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
