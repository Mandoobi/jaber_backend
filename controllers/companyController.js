const Company = require('../models/Company');
const mongoose = require('mongoose');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// 🏢 إنشاء شركة جديدة
const createCompany = async (req, res) => {
  try {
    const company = new Company(req.body);
    const saved = await company.save();
    res.status(201).json(saved);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: '❌ اسم الشركة موجود بالفعل' });
    }
    res.status(400).json({ message: '❌ فشل في إنشاء الشركة', error: error.message });
  }
};

// 📄 عرض كل الشركات
const getCompanies = async (req, res) => {
  try {
    const companies = await Company.find();
    res.json(companies);
  } catch (error) {
    res.status(500).json({ message: '❌ فشل في جلب الشركات', error: error.message });
  }
};

// 🔍 جلب شركة واحدة بالـ ID
const getCompanyById = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ message: '❌ معرف الشركة غير صالح' });
  }

  try {
    const company = await Company.findById(id);
    if (!company) {

      return res.status(404).json({ message: '❌ الشركة غير موجودة' });
    }
    res.json(company);
  } catch (error) {
    res.status(500).json({ message: '❌ فشل في جلب بيانات الشركة', error: error.message });
  }
};

// 🛠️ تحديث شركة بالـ ID
const updateCompany = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ message: '❌ معرف الشركة غير صالح' });
  }

  try {
    const updatedCompany = await Company.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedCompany) {
      return res.status(404).json({ message: '❌ الشركة غير موجودة' });
    }

    res.json(updatedCompany);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: '❌ اسم الشركة موجود بالفعل' });
    }
    res.status(400).json({ message: '❌ فشل في تحديث الشركة', error: error.message });
  }
};

module.exports = {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
};
