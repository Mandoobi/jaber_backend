const mongoose = require('mongoose');
const RepProductStock = require('../models/RepProductStock');
const Product = require('../models/Product');
const User = require('../models/User');
const RepStockHistory = require('../models/RepStockHistory');
const Sample = require('../models/Sample');

const getStartOfCurrentMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1); // بداية الشهر
};

const getMyStocks = async (req, res) => {
  try {
    const { userId, companyId, role } = req.user;
    if (role !== 'sales') return res.status(403).json({ success: false, message: '🚫 غير مصرح' });

    // جيب كل الأصناف مع الكميات اللي عند المندوب
    const stocks = await RepProductStock.find({ repId: userId, companyId }).populate('productId', 'name unitType');

    // شكل الناتج نرسل اسم المنتج، الكمية، نوع الوحدة
    const result = stocks.map(s => ({
      productId: s.productId._id,
      productName: s.productId.name,
      unitType: s.productId.unitType,
      quantity: s.quantity
    }));

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: '❌ خطأ في السيرفر' });
  }
};

const getProductStocksByReps = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { productId } = req.params;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: '❌ معرف المنتج غير صالح' });
    }

    const startOfMonth = getStartOfCurrentMonth();

    // 1. Get current stocks with valid populated data
    const stocks = await RepProductStock.find({ 
      companyId, 
      productId,
      repId: { $exists: true, $ne: null } // Only include docs with valid repId
    })
    .populate({
      path: 'repId',
      select: 'fullName',
      match: { _id: { $exists: true } } // Only populate if rep exists
    })
    .populate({
      path: 'productId',
      select: 'name unitType',  // أضفت unitType هنا
      match: { _id: { $exists: true } }
    })
    .lean();

    // Filter out any stocks with invalid populated data
    const validStocks = stocks.filter(stock => 
      stock.repId && stock.repId._id && stock.productId && stock.productId._id
    );

    const repIds = validStocks.map(s => s.repId._id.toString());

    // 2. Calculate stock changes since start of month
    const stockHistory = await RepStockHistory.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          productId: new mongoose.Types.ObjectId(productId),
          repId: { $in: repIds.map(id => new mongoose.Types.ObjectId(id)) },
          includeInAnalysis: true,
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: '$repId',
          totalTaken: { $sum: '$quantityChange' }
        }
      }
    ]);

    const takenMap = new Map();
    stockHistory.forEach(h => {
      takenMap.set(h._id.toString(), h.totalTaken);
    });

    // 3. Get distributed samples since start of month
    const samples = await Sample.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          productId: new mongoose.Types.ObjectId(productId),
          takenBy: { $in: repIds.map(id => new mongoose.Types.ObjectId(id)) },
          type: 'customer',
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: '$takenBy',
          totalSamplesDistributed: { $sum: '$quantity' }
        }
      }
    ]);

    const sampleMap = new Map();
    samples.forEach(s => {
      sampleMap.set(s._id.toString(), s.totalSamplesDistributed);
    });

    // 4. Prepare final result with all calculated data
    const result = validStocks.map(stock => {
      const repId = stock.repId._id.toString();
      return {
        repId,
        repName: stock.repId.fullName || 'غير معروف',
        quantity: stock.quantity,
        totalTakenFromStockHistory: takenMap.get(repId) || 0,
        totalSamplesDistributed: sampleMap.get(repId) || 0,
        productId: stock.productId._id.toString(),
        productName: stock.productId.name || 'غير معروف',
        unitType: stock.productId.unitType || 'غير معروف'  // أضفت هذا السطر
      };
    });

    res.json({ success: true, data: result });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '❌ خطأ في السيرفر' });
  }
};

const updateRepProductStock = async (req, res) => {
  try {
    const { companyId, userId } = req.user;
    const { repId, productId, quantity, includeInAnalysis = true } = req.body;

    if (typeof quantity !== 'number' || quantity < 0) {
      return res.status(400).json({ success: false, message: '❌ الكمية يجب أن تكون رقم صحيح غير سالب' });
    }

    const product = await Product.findOne({ _id: productId, companyId });
    if (!product) return res.status(404).json({ success: false, message: '❌ المنتج غير موجود' });

    const rep = await User.findOne({ _id: repId, companyId, role: 'sales' });
    if (!rep) return res.status(404).json({ success: false, message: '❌ المندوب غير موجود أو غير صالح' });

    const adminUser = await User.findById(userId);

    const existingStock = await RepProductStock.findOne({ companyId, repId, productId });

    const oldQuantity = existingStock ? existingStock.quantity : 0;
    const quantityChange = quantity - oldQuantity;

    if (quantityChange === 0) {
      return res.json({ success: true, message: 'لا تغيير في الكمية', data: existingStock });
    }

    const stock = await RepProductStock.findOneAndUpdate(
      { companyId, repId, productId },
      { quantity },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const reasonMessage = `${quantityChange > 0 ? 'تمت' : 'تم'} ${quantityChange > 0 ? 'إضافة' : 'حذف'} ${Math.abs(quantityChange)} وحدة بواسطة ${adminUser.fullName || 'مسؤول غير معروف'}.`;

    await RepStockHistory.create({
      companyId,
      repId,
      productId,
      quantityChange,
      includeInAnalysis, // ✅ هي الإضافة المهمة
      reason: reasonMessage,
      addedBy: userId
    });

    return res.json({ success: true, message: '✅ تم تحديث الكمية وتسجيل التغيير', data: stock });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: '❌ خطأ في السيرفر' });
  }
};

module.exports = {
  getMyStocks,
  getProductStocksByReps,
  updateRepProductStock
};
