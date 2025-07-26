const mongoose = require('mongoose');
const Counter = require('../../models/Counter');

const orderSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
  products: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    mainQuantity: { type: Number, required: true },
    bonusQuantity: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true },
  }],
  status: {
    type: String,
    enum: ['draft', 'preparing', 'ready', 'delivering', 'delivered', 'cancelled', 'returned'],
    default: 'draft',
    required: true
  },
  address: {
    city: { type: String, required: true }, // will be dropdown list 
    area: { type: String }, // will be text field 
    details: { type: String }, // will be text field 
  },
  notes: { type: String },
  deliveredBy: {
    type: String,
    enum: ['agent', 'company'],
  },
  deliveryDate: { type: Date },
  totalPrice: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  orderNumber: { type: String },
}, { timestamps: true });

orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      // جيب أو أنشئ الـ counter الخاص بالشركة
      const counter = await Counter.findOneAndUpdate(
        { companyId: this.companyId },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      // حط الرقم مع ترويسة 5 أصفار زي "00001"
      this.orderNumber = String(counter.seq).padStart(5, '0');
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model('Order', orderSchema);
