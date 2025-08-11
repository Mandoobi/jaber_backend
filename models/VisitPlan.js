const mongoose = require('mongoose');

const visitDaySchema = new mongoose.Schema({
  day: {
    type: String,
    enum: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    required: true
  },
  weekNumber: {
    type: Number,
    min: 1,
    max: 4,
    default: 1,
    required: true
  },
  title: {
    type: String,
    required: false, // اختيارية
    trim: true,
    maxlength: 100, // ممكن تحدد حد أقصى لطول العنوان
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
        const dayWeekSet = new Set(days.map(d => d.day + '_' + d.weekNumber));
        if (dayWeekSet.size !== days.length) return false; // تكرار يوم مع نفس رقم الأسبوع

        const allowedDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        for (const day of days) {
          if (!allowedDays.includes(day.day)) return false;
          if (typeof day.weekNumber !== 'number' || day.weekNumber < 1 || day.weekNumber > 4) return false;
        }

        return true;
      },
      message: '🛑 أيام الزيارات يجب أن تكون من الأحد إلى السبت، برقم أسبوع صحيح، وبدون تكرار لنفس اليوم ورقم الأسبوع'
    }
  }
}, { timestamps: true });

// ضمان وجود خطة واحدة لكل مندوب ضمن شركة واحدة
visitPlanSchema.index({ repId: 1, companyId: 1 }, { unique: true });

module.exports = mongoose.model('VisitPlan', visitPlanSchema);
