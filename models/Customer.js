const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    fullName: {
    type: String,
    required: true
    },
    phone: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    city: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: false, // جعلها اختيارية
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    notes: {
      type: String,
    },
    rank: {
      type: String,
      enum: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F'],
      default: 'C', // تقدر تغير الديفولت حسب ما تحب
    },
    rankWeight: {
        type: Number,
        default: 5, // رقم يمثل ترتيب C
        select: false // هذا يمنع ظهوره تلقائيًا في الـ response
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    managerName: {
      type: String,
      required: false // This is optional by default, but explicitly stating it
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true
    },
    customer_code: {
      type: String,
      trim: true,
      unique: true,
      sparse: true, // تسمح بتركيه فاضي بدون كسر الـ unique
      minlength: 3,
      maxlength: 20,
      match: /^[A-Z0-9\-]+$/ // أحرف كابيتال، أرقام، و"-" فقط
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', customerSchema);
