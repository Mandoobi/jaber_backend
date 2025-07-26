const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  rating: { type: Number, required: true },
  ratingComment: { type: String },
  type: { type: String, required: true },
  message: { type: String, required: true },
  name: { type: String },
  phone: { type: String },
  user: {
    fullName: { type: String },
    role: { type: String },
    companyId: { type: String }
  },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('Feedback', FeedbackSchema);
