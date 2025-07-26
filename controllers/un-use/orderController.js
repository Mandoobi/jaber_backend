const Order = require('./Order');
const Customer = require('../../models/Customer');
const Company = require('../../models/Company');
const User = require('../../models/User');
const Product = require('./Product');
const dayjs = require('../../utils/dayjs');  // استيراد dayjs المعدل
const mongoose = require('mongoose');

// إنشاء طلب جديد
const createOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId; // الشركة من بيانات المستخدم
    
    const {
      customerId,
      products,
      status,
      address,
      notes,
      deliveredBy,
      totalPrice
    } = req.body;
    
    // تحقق من وجود الشركة
    const company = await Company.findById(companyId);
    if (!company) return res.status(400).json({ message: '❌ الشركة غير موجودة' });

    // تحقق من العميل ونفس الشركة
    const customer = await Customer.findById(customerId);
    if (!customer || customer.companyId.toString() !== companyId)
      return res.status(400).json({ message: '❌ العميل غير موجود أو لا يتبع لنفس الشركة' });

    // تحقق من المندوب ونفس الشركة والدور
    if (req.user.companyId.toString() !== companyId)
      return res.status(400).json({ message: '❌ المندوب غير موجود أو لا يتبع لنفس الشركة' });

    // تحقق المنتجات وانتمائها للشركة
    const detailedProducts = await Promise.all(products.map(async (item) => {
      const product = await Product.findById(item.productId).select('name unitType companyId');
      if (!product) throw new Error(`❌ المنتج غير موجود ID: ${item.productId}`);
      if (product.companyId.toString() !== companyId)
        throw new Error(`❌ المنتج ${product.name} لا يتبع لنفس الشركة`);

      return {
        ...item,
        productName: product.name,
        unitType: product.unitType,
      };
    }));
    
    // إنشاء الطلب
    const order = new Order({
      customerId,
      companyId,
      createdBy: req.user.userId,
      products: detailedProducts,
      status,
      address,
      notes,
      deliveredBy,
      totalPrice,
    });

    const savedOrder = await order.save();
    res.status(201).json({ message: '✅ تم إنشاء الطلب بنجاح', order: savedOrder });

  } catch (err) {
    res.status(500).json({ message: '❌ فشل إنشاء الطلب', error: err.message });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) return res.status(400).json({ message: '❌ الشركة غير موجودة في بيانات المستخدم' });

    let {
      customerName,
      deliveredBy,
      status,
      createdBy,
      startDate,
      endDate,
      sort,
      customerId,
      page = 1,
      limit = 10,
      today,
    } = req.query;

    const errors = [];
    const objectIdPattern = /^[0-9a-fA-F]{24}$/;

    // Validation
    if (createdBy && !objectIdPattern.test(createdBy)) errors.push("❌ createdBy غير صالح");
    if (deliveredBy && !["agent", "company"].includes(deliveredBy)) errors.push("❌ deliveredBy لازم يكون 'agent' أو 'company'");
    if (status && !["draft", "preparing", "ready", "delivering", "delivered", "cancelled", "returned"].includes(status)) errors.push("❌ status غير معروف");
    if (startDate && isNaN(Date.parse(startDate))) errors.push("❌ startDate غير صالح");
    if (endDate && isNaN(Date.parse(endDate))) errors.push("❌ endDate غير صالح");
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      errors.push("❌ endDate لا يمكن أن يكون قبل startDate");
    }
    if (today && !["true", "false"].includes(today)) errors.push("❌ today لازم يكون 'true' أو 'false'");

    const allowedSorts = ['price_asc', 'price_desc', 'date_asc', 'date_desc'];
    if (sort && !allowedSorts.includes(sort)) {
      errors.push(`❌ sort لازم يكون واحد من: ${allowedSorts.join(', ')}`);
    }

    const pageNumber = Number(page);
    const limitNumber = Math.min(Number(limit), 50);

    if (isNaN(pageNumber) || pageNumber < 1) errors.push("❌ page غير صالحة");
    if (isNaN(limitNumber) || limitNumber < 1) errors.push("❌ limit غير صالح");

    if (errors.length > 0) {
      return res.status(400).json({ message: '❌ خطأ في البيانات', errors });
    }

    // Match stage init
    const matchStage = {
      companyId: new mongoose.Types.ObjectId(companyId)
    };

    if (deliveredBy) matchStage.deliveredBy = deliveredBy;
    if (status) matchStage.status = status;
    if (createdBy) matchStage.createdBy = new mongoose.Types.ObjectId(createdBy);
    if (customerId && objectIdPattern.test(customerId)) {
      matchStage.customerId = new mongoose.Types.ObjectId(customerId);
    }

    // Date filtering
    if (today === 'true') {
      // Use timezone-aware dayjs if needed, for now assume UTC or server timezone
      const startOfDay = dayjs().startOf('day').toDate();
      const endOfDay = dayjs().endOf('day').toDate();
      matchStage.createdAt = { $gte: startOfDay, $lte: endOfDay };
    } else if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = end;
      }
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } }
    ];

    // Smart customerName search: partial match on fullName with regex combined
    if (customerName) {
      const regex = new RegExp(customerName.trim().split(/\s+/).join('|'), 'i'); 
      pipeline.push({
        $match: {
          'customer.fullName': { $regex: regex }
        }
      });
    }

    // Get total count for pagination
    const totalOrders = await Order.aggregate([...pipeline, { $count: 'count' }]);
    const total = totalOrders[0]?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / limitNumber));
    const skip = (pageNumber - 1) * limitNumber;

    // Sorting
    const sortStage = {};
    switch (sort) {
      case 'price_asc':
        sortStage.totalPrice = 1;
        break;
      case 'price_desc':
        sortStage.totalPrice = -1;
        break;
      case 'date_asc':
        sortStage.createdAt = 1;
        break;
      case 'date_desc':
        sortStage.createdAt = -1;
        break;
      default:
        sortStage.createdAt = -1;
    }

    pipeline.push(
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limitNumber },

      // Lookup for creator (user)
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'creator'
        }
      },
      { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },

      // Lookup for company
      {
        $lookup: {
          from: 'companies',
          localField: 'companyId',
          foreignField: '_id',
          as: 'company'
        }
      },
      { $unwind: { path: '$company', preserveNullAndEmptyArrays: true } },

      // Lookup for product details, careful with array matching
      {
        $lookup: {
          from: 'products',
          localField: 'products.productId',
          foreignField: '_id',
          as: 'productDetails'
        }
      }
    );

    const orders = await Order.aggregate(pipeline);

    res.json({
      orders,
      totalOrders: total,
      totalPages,
      currentPage: pageNumber
    });

  } catch (err) {
    console.error('Error in getAllOrders:', err);
    res.status(500).json({ message: '❌ فشل جلب الطلبات', error: err.message });
  }
};

// جلب طلب حسب ID مع التأكد من الشركة
const getOrderById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await Order.findOne({ _id: req.params.id, companyId })
      .populate('customerId', 'name')
      .populate('companyId', 'name')
      .populate('createdBy', 'name')
      .populate('preparerId', 'name')
      .populate('products.productId', 'name price');

    if (!order) return res.status(404).json({ message: '❌ الطلب غير موجود أو ليس ضمن شركتك' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: '❌ فشل جلب الطلب', error: err.message });
  }
};

// تحديث الطلب (حالة + باقي الحقول)
const updateOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.userId;
    const { status, ...rest } = req.body;

    const order = await Order.findById(orderId).populate('statusHistory.changedBy', 'name email');
    if (!order) return res.status(404).json({ message: '❌ الطلب غير موجود' });

    if (status && status !== order.status) {
      order.statusHistory.push({
        fromStatus: order.status,  // الحالة القديمة
        toStatus: status,          // الحالة الجديدة
        changedBy: userId,
        changedAt: new Date()
      });
      order.status = status;
    }


    Object.assign(order, rest);

    await order.save();

    res.status(200).json({ message: '✅ تم تحديث الطلب', order });
  } catch (error) {
    res.status(500).json({ message: '❌ خطأ في تحديث الطلب', error: error.message });
  }
};

// حذف طلب
const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).json({ message: '❌ الطلب غير موجود' });
    res.json({ message: '✅ تم حذف الطلب بنجاح' });
  } catch (err) {
    res.status(500).json({ message: '❌ فشل حذف الطلب', error: err.message });
  }
};

// حذف كل الطلبات (اختياري)
const deleteAllOrders = async () => {
  try {
    await Order.deleteMany({});
    console.log('✅ تم حذف جميع الطلبات');
  } catch (err) {
    console.error('❌ فشل في حذف الطلبات:', err.message);
  }
};

module.exports = {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
  deleteAllOrders,
};
