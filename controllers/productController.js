const mongoose = require('mongoose');
const Product = require('../models/Product');
const Company = require('../models/Company');
const RepProductStock = require('../models/RepProductStock');

// إنشاء منتج
const createProduct = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({ message: '❌ الشركة غير موجودة' });
    }

    const productData = { ...req.body, companyId };
    const newProduct = new Product(productData);
    const savedProduct = await newProduct.save();

    res.status(201).json(savedProduct);

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: '❌ المنتج موجود مسبقًا' });
    }
    res.status(400).json({ message: '❌ فشل في إنشاء المنتج', error: err.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const ObjectId = mongoose.Types.ObjectId;
    const companyId = new ObjectId(req.user.companyId);

    let {
      name,
      unitType,
      weightUnit,
      isActive,
      page,
      limit,
      includeStocks,
      repIdStock
    } = req.query;

    // تنظيف البيانات
    name = name?.trim();
    unitType = unitType?.trim();
    weightUnit = weightUnit?.trim();

    const query = { companyId };

    if (name) query.name = { $regex: `^${name}`, $options: 'i' };
    if (unitType) query.unitType = unitType;
    if (weightUnit) query.weightUnit = weightUnit;

    if (isActive !== undefined) {
      if (isActive !== 'true' && isActive !== 'false') {
        return res.status(400).json({ message: '❌ isActive يجب أن يكون true أو false' });
      }
      query.isActive = isActive === 'true';
    }

    // إعداد الصفحات
    let pageNumber = page === undefined ? 1 : Number(page);
    const maxLimit = 50;
    let limitNumber = limit === undefined ? 20 : Number(limit);
    limitNumber = Math.min(limitNumber, maxLimit);

    if (isNaN(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ message: '❌ page يجب أن يكون رقم صحيح وأكبر من 0' });
    }

    if (isNaN(limitNumber) || limitNumber < 1) {
      return res.status(400).json({ message: '❌ limit يجب أن يكون رقم صحيح وأكبر من 0' });
    }

    const skip = (pageNumber - 1) * limitNumber;

    const [totalProducts, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query).skip(skip).limit(limitNumber).lean()
    ]);

    // من نستخدم لحساب المخزون؟
    let repIdToUse = null;

    if (repIdStock) {
      repIdToUse = new ObjectId(repIdStock); // جاي من الأدمن مثلاً
    } else if (req.user.role === 'sales') {
      repIdToUse = new ObjectId(req.user.userId); // المندوب نفسه
    }

    // جلب الكميات للمندوب إن وُجد
    if (includeStocks === 'true' && repIdToUse) {
      const productIds = products.map(p => p._id);
      const repStocks = await RepProductStock.find({
        companyId,
        repId: repIdToUse,
        productId: { $in: productIds }
      }).lean();

      const stockMap = {};
      for (let stock of repStocks) {
        stockMap[stock.productId.toString()] = stock.quantity;
      }

      for (let product of products) {
        product.repStock = stockMap[product._id.toString()] || 0;
      }
    }

    const totalPages = Math.max(1, Math.ceil(totalProducts / limitNumber));
    const currentPage = Math.min(pageNumber, totalPages);

    res.json({
      products,
      totalProducts,
      totalPages,
      currentPage
    });

  } catch (err) {
    res.status(500).json({ message: '❌ فشل في جلب الأصناف', error: err.message });
  }
};

// جلب منتج حسب ID والتأكد من الشركة
const getProductById = async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: '❌ معرف المنتج غير صالح' });
  }

  try {
    const product = await Product.findOne({ _id: id, companyId });
    if (!product) {
      return res.status(404).json({ message: '❌ المنتج غير موجود أو لا يتبع لنفس الشركة' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: '❌ خطأ في جلب المنتج', error: err.message });
  }
};

// تحديث منتج مع التحقق من الشركة
const updateProduct = async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: '❌ معرف المنتج غير صالح' });
  }

  // تصفية الحقول المسموح بتعديلها
  const allowedFields = ['name', 'description', 'unitType', 'weight', 'weightUnit', 'isActive'];
  const updateData = {};
  for (let field of allowedFields) {
    if (field in req.body) {
      updateData[field] = req.body[field];
    }
  }

  try {
    const updated = await Product.findOneAndUpdate(
      { _id: id, companyId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: '❌ المنتج غير موجود أو لا يتبع لنفس الشركة' });
    }
    res.json(updated);

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: '❌ تعارض في البيانات (ربما الباركود موجود)' });
    }
    res.status(400).json({ message: '❌ فشل في تحديث المنتج', error: err.message });
  }
};

// حذف منتج مع التحقق من الشركة
const deleteProduct = async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: '❌ معرف المنتج غير صالح' });
  }

  try {
    const deleted = await Product.findOneAndDelete({ _id: id, companyId });
    if (!deleted) {
      return res.status(404).json({ message: '❌ المنتج غير موجود أو لا يتبع لنفس الشركة' });
    }
    res.json({ message: '✅ تم حذف المنتج بنجاح' });
  } catch (err) {
    res.status(500).json({ message: '❌ فشل في حذف المنتج', error: err.message });
  }
};

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
