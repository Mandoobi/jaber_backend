const mongoose = require('mongoose');

const visitDaySchema = new mongoose.Schema({
  day: {
    type: String,
    enum: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    required: true
  },
  customers: [
    {
      customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
      fullName: { type: String, required: true }
    }
  ]
}, { _id: false });

const visitPlanSchema = new mongoose.Schema({
  repId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  },
  days: {
    type: [visitDaySchema],
    validate: {
      validator: function (days) {
        const daysSet = new Set(days.map(d => d.day));
        if (daysSet.size !== days.length) return false; // تكرار يوم
        const allowedDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        for (const day of daysSet) {
          if (!allowedDays.includes(day)) return false;
        }
        return true;
      },
      message: '🛑 أيام الزيارات يجب أن تكون من الأحد إلى السبت وبدون تكرار'
    }
  }
}, { timestamps: true });

// ضمان وجود خطة واحدة لكل مندوب ضمن شركة واحدة
visitPlanSchema.index({ repId: 1, companyId: 1 }, { unique: true });

module.exports = mongoose.model('VisitPlan', visitPlanSchema);
