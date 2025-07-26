const mongoose = require('mongoose');
const Product = require('./Product');
const Company = require('../../models/Company');

// إنشاء منتج
const createProduct = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400)({ message: '❌ الشركة غير موجودة' });
    }

    const productData = { ...req.body, companyId };
    const newProduct = new Product(productData);
    const savedProduct = await newProduct.save();

    res.status(201).json(savedProduct);

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: '❌ المنتج موجود مسبقًا (ربما نفس الباركود أو الكود)' });
    }
    res.status(400).json({ message: '❌ فشل في إنشاء المنتج', error: err.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    let {
      name,
      category,
      minPrice,
      maxPrice,
      isActive,
      unitType,
      sort,
      page,
      limit
    } = req.query;

    // Clean string inputs
    name = name?.trim();
    category = category?.trim();
    unitType = unitType?.trim();
    sort = sort?.trim();

    let query = { companyId };

    // Filters
    if (name) {
      query.name = { $regex: `^${name}`, $options: 'i' }; // Starts with
    }

    if (category) {
      query.category = category;
    }

    if (minPrice != null) {
      const parsedMin = Number(minPrice);
      if (isNaN(parsedMin)) return res.status(400).json({ message: '❌ minPrice يجب أن يكون رقمًا' });
      query.price = { ...(query.price || {}), $gte: parsedMin };
    }

    if (maxPrice != null) {
      const parsedMax = Number(maxPrice);
      if (isNaN(parsedMax)) return res.status(400).json({ message: '❌ maxPrice يجب أن يكون رقمًا' });
      query.price = { ...(query.price || {}), $lte: parsedMax };
    }

    if (isActive !== undefined) {
      if (isActive !== 'true' && isActive !== 'false') {
        return res.status(400).json({ message: '❌ isActive يجب أن يكون true أو false' });
      }
      query.isActive = isActive === 'true';
    }

    if (unitType) {
      query.unitType = unitType;
    }

    // Sorting
    let sortOption = {};
    const allowedSorts = ['price_desc', 'price_asc', 'name_asc', 'createdAt_desc'];
    if (sort && !allowedSorts.includes(sort)) {
      return res.status(400).json({
        message: '❌ قيمة sort غير صالحة، استخدم: price_desc, price_asc, name_asc, createdAt_desc'
      });
    }
    if (sort === 'price_desc') sortOption.price = -1;
    else if (sort === 'price_asc') sortOption.price = 1;
    else if (sort === 'name_asc') sortOption.name = 1;
    else if (sort === 'createdAt_desc') sortOption.createdAt = -1;

    // Pagination
    let pageNumber = page === undefined ? 1 : Number(page);
    const maxLimit = 50;
    let limitNumber = limit === undefined ? 20 : Number(limit);
    limitNumber = Math.min(limitNumber, maxLimit);

    if (isNaN(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ message: '❌ قيمة page يجب أن تكون رقم صحيح وأكبر من 0' });
    }

    if (isNaN(limitNumber) || limitNumber < 1) {
      return res.status(400).json({ message: '❌ قيمة limit يجب أن تكون رقم صحيح وأكبر من 0' });
    }

    const skip = (pageNumber - 1) * limitNumber;

    // Parallel count + data fetch
    const [totalProducts, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query).sort(sortOption).skip(skip).limit(limitNumber)
    ]);

    const totalPages = Math.max(1, Math.ceil(totalProducts / limitNumber));
    const currentPage = Math.min(pageNumber, totalPages);

    res.json({
      products,
      totalProducts,
      totalPages,
      currentPage
    });

  } catch (err) {
    res.status(500).json({ message: '❌ فشل في جلب المنتجات', error: err.message });
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

  try {
    const updated = await Product.findOneAndUpdate(
      { _id: id, companyId },
      req.body,
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
