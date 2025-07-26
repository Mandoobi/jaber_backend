const mongoose = require('mongoose');

const updateSchema = new mongoose.Schema({
  version: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  roles: [String],
  date: { type: Date, default: Date.now },
  image: { type: String },
  actionLink: { type: String },
  isCritical: { type: Boolean, default: false }, // Modal + Dashboard
  points: { type: [String], default: [] },
});


module.exports = mongoose.model('Update', updateSchema);
