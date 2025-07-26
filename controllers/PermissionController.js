// controllers/permissionController.js
const Permission = require('../models/Permission');

// إنشاء صلاحية جديدة
const createPermission = async (req, res) => {
  try {
    const { name, label } = req.body;
    const exists = await Permission.findOne({ name });
    if (exists) return res.status(400).json({ message: 'Permission already exists' });

    const permission = new Permission({ name, label });
    await permission.save();
    res.status(201).json(permission);
  } catch (err) {
    res.status(500).json({ message: 'Error creating permission', error: err.message });
  }
};

// جلب كل الصلاحيات
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find();
    res.json(permissions);
  } catch (err) {
    res.status(500).json({ message: 'Error getting permissions', error: err.message });
  }
};

module.exports = {
  createPermission,
  getAllPermissions,
};
