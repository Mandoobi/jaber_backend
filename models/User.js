const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  permissions: {
  type: [String],
  default: [],
},
  password: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  lastSeenUpdate: {
  type: String,
  default: null,
  },  
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  role: {
  type: String,
  enum: ['owner', 'admin', 'preparer', 'sales'],
  default: 'preparer',
  required: true
},
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// تشفير كلمة السر قبل الحفظ
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// طريقة للتحقق من كلمة السر
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
