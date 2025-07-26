const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true, // يمنع التكرار
    trim: true
  },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  address: { type: String, required: true },
  managerName: { type: String, required: true },
  managerPhone: { type: String, required: true },
  socialMedia: String,
  logo: String,
  website: String,
  notes: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });



const Company = mongoose.model('Company', companySchema);
module.exports = Company;
