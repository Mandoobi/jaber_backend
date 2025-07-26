// models/Permission.js
const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // مثل: 'can_edit_customers'
  description: { type: String } // عشان تفهم شو معناها من لوحة الإدارة
});

module.exports = mongoose.model('Permission', permissionSchema);
