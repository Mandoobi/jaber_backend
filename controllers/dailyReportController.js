const mongoose = require('mongoose');
const User = require('../models/User');
const DailyReport = require('../models/DailyReport');
const Customer = require('../models/Customer');
const VisitPlan = require('../models/VisitPlan');
const Notification = require('../models/Notification');
const RepProductStock = require('../models/RepProductStock');
const RepStockHistory = require('../models/RepStockHistory');
const Sample = require('../models/Sample');
const Product = require('../models/Product');
const calculateVisitStats = require('../utils/visitStats');
const { now, parseWithTZ } = require('../utils/dayjs');
const { cloudinary, upload, deleteImage } = require('../config/cloudinary');
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
const sendSuccess = (res, status, message, data = null) => 
  res.status(status).json({ success: true, message, ...(data && { data }) });

// Enhanced verifyCustomers function to include customer code
const verifyCustomers = async (customerIds, companyId) => {
  try {
    // Validate all customer IDs
    const invalidIds = customerIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return `📛 تحتوي على معرفات عملاء غير صالحة: ${invalidIds.join(', ')}`;
    }

    // Convert to ObjectId
    const customerObjectIds = customerIds.map(id => new mongoose.Types.ObjectId(id));
    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    // Find customers and verify company match
    const customers = await Customer.find({
      _id: { $in: customerObjectIds }
    }).select('_id companyId customer_code').lean();

    // Verify each customer
    const invalidCustomers = [];
    for (const customerId of customerObjectIds) {
      const customer = customers.find(c => c._id.equals(customerId));
      
      if (!customer) {
        invalidCustomers.push({
          id: customerId,
          reason: 'not_found'
        });
        continue;
      }

      if (!customer.companyId.equals(companyObjectId)) {
        invalidCustomers.push({
          id: customerId,
          reason: 'company_mismatch',
          customerCompany: customer.companyId.toString(),
          expectedCompany: companyObjectId.toString()
        });
      }
    }

    if (invalidCustomers.length > 0) {
      console.error('Validation failed with:', invalidCustomers);
      const invalidIds = invalidCustomers.map(c => c.id.toString());
      return `📛 العملاء التالية غير موجودين أو لا ينتمون لشركتك: ${invalidIds.join(', ')}`;
    }

    return null;
  } catch (error) {
    console.error('Verification error:', error);
    return '❌ خطأ في التحقق من العملاء';
  }
};

const getAdmins = async (companyId, excludeUserId = null) => {
  let query = { companyId, role: 'admin' };
  let admins = await User.find(query, '_id');

  let adminIds = admins.map(admin => admin._id.toString());

  if (excludeUserId) {
    adminIds = adminIds.filter(id => id !== excludeUserId.toString());
  }

  return adminIds;
};

const getSingleReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, userId, companyId } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, '📛 معرف التقرير غير صالح');
    }

    // First verify the report exists and belongs to the company
    const report = await DailyReport.findOne({ _id: id, companyId })
      .populate({
        path: 'repId',
        match: { companyId },
        select: '_id fullName name email phone'
      })
      .populate({
        path: 'visits.customerId',
        match: { companyId },
        select: '_id fullName phone isActive city address customer_code',
        options: { lean: true }
      })
      .lean();

    if (!report) {
      return sendError(res, 404, '❌ التقرير غير موجود أو لا ينتمي لشركتك');
    }

    if (!report.repId) {
      return sendError(res, 403, '🚫 لا يمكنك الوصول إلى هذا التقرير');
    }

    // Get samples for this report
    const samples = await Sample.find({ reportId: id })
      .populate({
        path: 'productId',
        select: 'name weight weightUnit unitType'
      })
      .populate({
        path: 'customerId',
        select: 'fullName phone customer_code'
      })
      .lean();

    // Authorization check for sales reps
    if (role === 'sales') {
      if (report.repId._id.toString() !== userId) {
        return sendError(res, 403, '🚫 لا يمكنك الوصول إلى تقارير مندوبين آخرين');
      }
      
      const userValid = await User.exists({
        _id: userId,
        companyId,
        role: 'sales',
        isActive: true
      });
      
      if (!userValid) {
        return sendError(res, 403, '🚫 حسابك غير مفعل أو لا ينتمي لهذه الشركة');
      }
    } else if (role === 'admin') {
      const repValid = await User.exists({
        _id: report.repId._id,
        companyId,
        role: 'sales'
      });
      
      if (!repValid) {
        return sendError(res, 403, '🚫 المندوب لا ينتمي لشركتك');
      }
    }

    // Filter out any visits where customer doesn't belong to company
    const validVisits = report.visits.filter(visit => visit.customerId !== null);

    // Format the report with customer code
    const formattedReport = {
      ...report,
      visits: validVisits.map(visit => ({
        ...visit,
        customerCode: visit.customer_code || visit.customerId?.customer_code || null,
        customerInfo: {
          name: visit.customerId?.fullName || '[Deleted Customer]',
          phone: visit.customerId?.phone || 'N/A',
          city: visit.customerId?.city || 'N/A',
          address: visit.customerId?.isActive ? visit.customerId.address : 'N/A',
          isActive: visit.customerId?.isActive ?? false,
          customer_code: visit.customerId?.customer_code || null
        }
      })),
      samples: samples.map(sample => ({
        _id: sample._id,
        type: sample.type,
        productId: sample.productId?._id,
        productName: sample.productId?.name,
        quantity: sample.quantity,
        weight: sample.productId?.weight,
        weightUnit: sample.productId?.weightUnit,
        unitType: sample.productId?.unitType,
        customerId: sample.customerId?._id,
        customerName: sample.customerId?.fullName,
        customerCode: sample.customerId?.customer_code || null,
        notes: sample.notes
      })),
      repInfo: {
        name: report.repId.fullName,
        email: report.repId.email,
        phone: report.repId.phone
      },
      stats: {
        ...report.stats,
        date: report.date,
        day: report.day
      }
    };

    return sendSuccess(res, 200, '✅ تم جلب التقرير بنجاح', { 
      report: formattedReport,
      pdfMeta: {
        title: `Daily Report - ${report.date}`,
        header: {
          date: report.date,
          repName: report.repId.fullName,
          totalVisits: report.stats.totalVisits,
          completedVisits: report.stats.completedVisits
        },
        printableSections: ['visits']
      }
    });

  } catch (error) {
    console.error('[GET SINGLE REPORT ERROR]', error);
    return sendError(res, 500, '❌ خطأ في الخادم الداخلي');
  }
};

// Helper functions
const validateVisits = (visits) => {
  if (!visits || !Array.isArray(visits)) {
    return { isValid: false, error: '📛 يجب تقديم قائمة زيارات صالحة' };
  }

  const cleanedVisits = visits.map(v => {
    const visit = {
      customerId: v.customerId,
      status: v.status,
      reason: v.reason || '',
      notes: v.notes || '',
      isExtra: v.isExtra || false
    };
    if (v.status === 'visited' && v.duration !== null) {
      visit.duration = v.duration;
    }
    return visit;
  });

  return { isValid: true, cleanedVisits };
};

// Enhanced validateCustomers to include customer code
const validateCustomers = async (customerIds, companyId) => {
  const customers = await Customer.find({ 
    _id: { $in: customerIds },
    companyId 
  }).select('_id companyId customer_code').lean();

  if (customers.length !== customerIds.length) {
    const missingCustomers = customerIds.filter(id => 
      !customers.some(c => c._id.toString() === id.toString())
    );
    return `❌ بعض العملاء غير موجودين أو لا ينتمون لشركتك: ${missingCustomers.join(', ')}`;
  }
  return null;
};

// Enhanced processVisitsForSalesRep to include customer code
const processVisitsForSalesRep = async (visits, repId, companyId, day) => {
  const visitPlan = await VisitPlan.findOne({ repId, companyId });
  let plannedCustomerIds = [];
  
  if (visitPlan) {
    const todayPlan = visitPlan.days.find(d => d.day === day);
    if (todayPlan?.customers) {
      plannedCustomerIds = todayPlan.customers.map(c => c.customerId.toString());
    }
  }

  // Get customer info including codes for all visits
  const customerIds = visits.map(v => v.customerId);
  const customers = await Customer.find(
    { _id: { $in: customerIds } },
    { _id: 1, customer_code: 1, fullName: 1 }
  ).lean();

  return visits.map(v => {
    const customer = customers.find(c => c._id.equals(v.customerId));
    return {
      ...v,
      customerCode: customer?.customer_code || null,
      isExtra: !plannedCustomerIds.includes(v.customerId.toString())
    };
  });
};

const validateSamples = async (samples, companyId, userId) => {
  const validationResults = await Promise.all(samples.map(async (s, index) => {
    const errors = [];
    
    // Basic validation
    if (!s.productId || !mongoose.Types.ObjectId.isValid(s.productId)) {
      errors.push('Invalid product ID');
    }
    if (!s.quantity || s.quantity <= 0) {
      errors.push('Quantity must be greater than 0');
    }
    if (!['customer', 'personal'].includes(s.type)) {
      errors.push('Invalid sample type');
    }

    // Validate product exists and belongs to company
    if (s.productId && mongoose.Types.ObjectId.isValid(s.productId)) {
      const product = await Product.findOne({
        _id: s.productId,
        companyId
      });
      if (!product) {
        errors.push('Product not found or not in company');
      }
    }

    // Additional validation for customer samples
    if (s.type === 'customer') {
      if (!s.customerId || !mongoose.Types.ObjectId.isValid(s.customerId)) {
        errors.push('Invalid customer ID');
      } else {
        // Validate customer exists and belongs to company
        const customer = await Customer.findOne({
          _id: s.customerId,
          companyId
        });
        if (!customer) {
          errors.push('Customer not found or not in company');
        }
      }
    }

    return {
      sample: s,
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }));

  return {
    validSamples: validationResults.filter(r => r.isValid).map(r => r.sample),
    invalidSamples: validationResults.filter(r => !r.isValid)
  };
};

// Main controller
const createOrUpdateReport = async (req, res) => {
  try {
    const { role, userId, companyId, username } = req.user;

    // Parse form data
    const {
      notes,
      reportId,
      isAdminUpdate = 'false',
      existingImages // Array of image URLs that should remain
    } = req.body;

    const visits = req.body.visits ? JSON.parse(req.body.visits) : [];
    const samples = req.body.samples ? JSON.parse(req.body.samples) : [];
    const deletedSamples = req.body.deletedSamples ? JSON.parse(req.body.deletedSamples) : [];
    const keptImages = existingImages ? JSON.parse(existingImages) : [];
    const newImages = req.files ? req.files.map(file => file.path) : [];

    // Validate visits
    const { isValid: visitsValid, cleanedVisits, error: visitsError } = validateVisits(visits);
    if (!visitsValid) {
      return sendError(res, 400, visitsError);
    }

    // Validate customers
    const customerIds = cleanedVisits.map(v => v.customerId);
    const customersError = await validateCustomers(customerIds, companyId);
    if (customersError) return sendError(res, 400, customersError);

    const currentDate = now();
    const dateStr = currentDate.format('YYYY-MM-DD');
    const day = currentDate.format('dddd');

    // SALES REP LOGIC
    if (role === 'sales') {
      let report = await DailyReport.findOne({
        repId: userId,
        companyId,
        date: dateStr
      });

      if (reportId && (!report || !report._id.equals(reportId))) {
        return sendError(res, 400, '📛 يمكنك فقط تعديل تقرير اليوم الخاص بك');
      }

      const processedVisits = await processVisitsForSalesRep(cleanedVisits, userId, companyId, day);
      const stats = calculateVisitStats(processedVisits);

      if (report) {
        // Handle image deletions for existing reports
        const imagesToDelete = report.images.filter(img => !keptImages.includes(img));
        
        // Delete images from Cloudinary
        await Promise.all(imagesToDelete.map(async (imageUrl) => {
          try {
            const parts = imageUrl.split('/');
            const folder = parts[parts.length - 2];
            const fileName = parts[parts.length - 1].split('.')[0];
            const publicId = `${folder}/${fileName}`;

            await deleteImage(publicId);
          } catch (error) {
            console.error('Error deleting image:', error);
          }
        }));
        // Combine kept images with new images
        const updatedImages = [...keptImages, ...newImages];

        // Update report
        report.notes = notes || report.notes;
        report.visits = processedVisits;
        report.stats = stats;
        report.images = updatedImages;
        await report.save();
      } else {
        // New report - just use the new images
        report = new DailyReport({
          companyId,
          repId: userId,
          date: dateStr,
          day,
          notes: notes || '',
          visits: processedVisits,
          stats,
          images: newImages
        });
        await report.save();
      }

      // First handle deletions - return stock
      if (deletedSamples && deletedSamples.length > 0) {
        const deletedSamplesData = await Sample.find({
          _id: { $in: deletedSamples },
          reportId: report._id,
          companyId
        });
        
        await Promise.all(deletedSamplesData.map(async (sample) => {
          await RepProductStock.findOneAndUpdate(
            { companyId, repId: userId, productId: sample.productId },
            { $inc: { quantity: sample.quantity } },
            { upsert: true }
          );
          
          await RepStockHistory.create({
            companyId,
            repId: userId,
            productId: sample.productId,
            quantityChange: sample.quantity,
            reason: 'Sample deleted from report',
            addedBy: userId,
            includeInAnalysis: false
          });
        }));
        
        await Sample.deleteMany({
          _id: { $in: deletedSamples },
          reportId: report._id,
          companyId
        });
      }

      if (Array.isArray(samples) && samples.length > 0) {
        // First validation layer - basic validation
        const { validSamples, invalidSamples } = await validateSamples(samples, companyId, userId);
        
        if (invalidSamples && invalidSamples.length > 0) {
          return sendError(res, 400, {
            message: 'بعض العينات غير صالحة',
            invalidSamples
          });
        }

        // Get all existing samples for this report
        const existingSamples = await Sample.find({
          reportId: report._id,
          companyId
        });

        // Separate samples into existing (being updated) and new (being added)
        const updatedSamples = validSamples.filter(s => s._id);
        const newSamples = validSamples.filter(s => !s._id);

        // Check stock for NEW samples
        const newSamplesStockCheck = await Promise.all(newSamples.map(async (sample) => {
          const stock = await RepProductStock.findOne({
            companyId,
            repId: userId,
            productId: sample.productId
          });
          
          const availableQuantity = stock ? stock.quantity : 0;
          return {
            sample,
            hasEnoughStock: availableQuantity >= sample.quantity,
            availableQuantity,
            requiredQuantity: sample.quantity,
            productId: sample.productId
          };
        }));

        // Check stock for UPDATED samples (only if quantity increased)
        const updatedSamplesStockCheck = await Promise.all(updatedSamples.map(async (sample) => {
          const stock = await RepProductStock.findOne({
            companyId,
            repId: userId,
            productId: sample.productId
          });
          
          const availableQuantity = stock ? stock.quantity : 0;
          const existingSample = existingSamples.find(s => s._id.equals(sample._id));
          const quantityDiff = sample.quantity - (existingSample?.quantity || 0);
          
          return {
            sample,
            hasEnoughStock: quantityDiff <= 0 || availableQuantity >= quantityDiff,
            availableQuantity,
            requiredQuantity: quantityDiff > 0 ? quantityDiff : 0,
            productId: sample.productId,
            existingQuantity: existingSample?.quantity || 0
          };
        }));

        // Combine all stock check results
        const allStockChecks = [...newSamplesStockCheck, ...updatedSamplesStockCheck];
        
        // Check for samples with insufficient stock
        const insufficientStockSamples = allStockChecks.filter(result => 
          result.requiredQuantity > 0 && !result.hasEnoughStock
        );
        
        if (insufficientStockSamples.length > 0) {
          // Get product details for better error messages
          const productIds = insufficientStockSamples.map(s => s.productId);
          const products = await Product.find({ _id: { $in: productIds } }).lean();
          
          const errorDetails = insufficientStockSamples.map(sample => {
            const product = products.find(p => p._id.equals(sample.productId));
            return {
              productName: product ? product.name : 'منتج غير معروف',
              available: sample.availableQuantity,
              required: sample.requiredQuantity,
              existing: sample.existingQuantity || 0
            };
          });
          
          const errorMessages = errorDetails.map(detail => 
            `المنتج "${detail.productName}" - الكمية المتاحة: ${detail.available}، الكمية المطلوبة: ${detail.required}` +
            (detail.existing ? ` (الكمية الحالية: ${detail.existing})` : '')
          );
          
          return sendError(res, 400, {
            message: '❌ لا يوجد مخزون كافي للعينات التالية:',
            details: errorMessages,
            insufficientStockSamples: errorDetails
          });
        }

        // Process stock changes for NEW samples (full quantity)
        await Promise.all(newSamplesStockCheck.map(async (result) => {
          if (result.requiredQuantity > 0) {
            await RepProductStock.findOneAndUpdate(
              { companyId, repId: userId, productId: result.productId },
              { $inc: { quantity: -result.requiredQuantity } },
              { upsert: true }
            );
            
            await RepStockHistory.create({
              companyId,
              repId: userId,
              productId: result.productId,
              quantityChange: -result.requiredQuantity,
              reason: 'New sample added to report',
              addedBy: userId,
              includeInAnalysis: false
            });
          }
        }));

        // Process stock changes for UPDATED samples (only the difference)
        await Promise.all(updatedSamplesStockCheck.map(async (result) => {
          if (result.requiredQuantity > 0) {
            await RepProductStock.findOneAndUpdate(
              { companyId, repId: userId, productId: result.productId },
              { $inc: { quantity: -result.requiredQuantity } },
              { upsert: true }
            );
            
            await RepStockHistory.create({
              companyId,
              repId: userId,
              productId: result.productId,
              quantityChange: -result.requiredQuantity,
              reason: 'Sample quantity increased in report',
              addedBy: userId,
              includeInAnalysis: false
            });
          } else if (result.requiredQuantity < 0) {
            const quantityToReturn = Math.abs(result.requiredQuantity);
            await RepProductStock.findOneAndUpdate(
              { companyId, repId: userId, productId: result.productId },
              { $inc: { quantity: quantityToReturn } },
              { upsert: true }
            );
            
            await RepStockHistory.create({
              companyId,
              repId: userId,
              productId: result.productId,
              quantityChange: quantityToReturn,
              reason: 'Sample quantity decreased in report',
              addedBy: userId,
              includeInAnalysis: false
            });
          }
        }));

        // Update or create samples
        const bulkOps = validSamples.map(sample => ({
          updateOne: {
            filter: { _id: sample._id || new mongoose.Types.ObjectId() },
            update: { 
              $set: {
                companyId,
                takenBy: userId,
                productId: sample.productId,
                quantity: sample.quantity,
                type: sample.type,
                reportId: report._id,
                notes: sample.notes || '',
                ...(sample.type === 'customer' && { customerId: sample.customerId })
              }
            },
            upsert: true
          }
        }));

        await Sample.bulkWrite(bulkOps);
      }

      const adminIds = await getAdmins(companyId, userId);
      await Notification.create({
        userId: userId,
        targetUsers: adminIds,
        actionType: reportId ? 'update_daily_report' : 'send_daily_report',
        description: reportId
          ? `قام المستخدم ${username} بتحديث تقريره اليومي.`
          : `قام المستخدم ${username} بإرسال تقريره اليومي بنجاح.`,
        relatedEntity: {
          entityType: 'DailyReport',
          entityId: report._id
        },
        data: {
          date: dateStr,
          repName: username,
          visitsCount: stats.totalVisits,
          completedVisits: stats.completedVisits
        }
      });

      return sendSuccess(
        res,
        reportId ? 200 : 201,
        reportId ? '✅ تم تحديث التقرير بنجاح' : '✅ تم إنشاء التقرير بنجاح',
        {
          report: report.toObject()
        }
      );
    }

    // ADMIN LOGIC
    if (role === 'admin') {
      if (!reportId) {
        return sendError(res, 400, '📛 يجب تقديم معرف التقرير للتحديث');
      }

      const report = await DailyReport.findOne({ _id: reportId, companyId });
      if (!report) {
        return sendError(res, 404, '❌ التقرير غير موجود أو لا ينتمي لشركتك');
      }

      const repId = report.repId; // Original rep's ID
      const processedVisits = await processVisitsForSalesRep(cleanedVisits, repId, companyId, day);
      const stats = calculateVisitStats(processedVisits);

      // Handle image deletions for existing reports
      const imagesToDelete = report.images.filter(img => !keptImages.includes(img));
      
      // Delete images from Cloudinary
     await Promise.all(imagesToDelete.map(async (imageUrl) => {
      try {
        const parts = imageUrl.split('/');
        const folder = parts[parts.length - 2];
        const fileName = parts[parts.length - 1].split('.')[0];
        const publicId = `${folder}/${fileName}`;

        await deleteImage(publicId);
      } catch (error) {
        console.error('Error deleting image:', error);
      }
    }));

      // Combine kept images with new images
      const updatedImages = [...keptImages, ...newImages];

      // Update report
      report.notes = notes || report.notes;
      report.visits = processedVisits;
      report.stats = stats;
      report.images = updatedImages;
      await report.save();

      // Handle deletions - return stock to original rep
      if (deletedSamples && deletedSamples.length > 0) {
        const deletedSamplesData = await Sample.find({
          _id: { $in: deletedSamples },
          reportId: report._id,
          companyId
        });
        
        await Promise.all(deletedSamplesData.map(async (sample) => {
          await RepProductStock.findOneAndUpdate(
            { companyId, repId: repId, productId: sample.productId },
            { $inc: { quantity: sample.quantity } },
            { upsert: true }
          );
          
          await RepStockHistory.create({
            companyId,
            repId: repId,
            productId: sample.productId,
            quantityChange: sample.quantity,
            reason: 'Admin deleted sample from report',
            addedBy: userId,
            includeInAnalysis: false
          });
        }));
        
        await Sample.deleteMany({
          _id: { $in: deletedSamples },
          reportId: report._id,
          companyId
        });
      }

      // Handle new/updated samples for admin
      if (Array.isArray(samples) && samples.length > 0) {
        // First validation layer - basic validation
        const { validSamples, invalidSamples } = await validateSamples(samples, companyId, userId);
        
        if (invalidSamples && invalidSamples.length > 0) {
          return sendError(res, 400, {
            message: 'بعض العينات غير صالحة',
            invalidSamples
          });
        }

        // Get all existing samples for this report to compare quantities
        const existingSamples = await Sample.find({
          reportId: report._id,
          companyId
        });

        // Second validation layer - check stock availability
        const stockCheckResults = await Promise.all(validSamples.map(async (sample) => {
          const stock = await RepProductStock.findOne({
            companyId,
            repId: userId,
            productId: sample.productId
          });
          
          const availableQuantity = stock ? stock.quantity : 0;
          const existingSample = existingSamples.find(s => 
            sample._id ? s._id.equals(sample._id) : s.productId.equals(sample.productId)
          );
          
          // Calculate the net change in quantity
          let netChange = 0;
          let isNewSample = false;
          
          if (existingSample) {
            netChange = sample.quantity - existingSample.quantity;
          } else {
            netChange = sample.quantity;
            isNewSample = true;
          }
          
          return {
            sample,
            hasEnoughStock: netChange <= 0 || availableQuantity >= netChange, // Only check if increasing quantity
            availableQuantity,
            requiredQuantity: netChange,
            productId: sample.productId,
            isNewSample,
            existingQuantity: existingSample?.quantity || 0
          };
        }));

        // Check for samples with insufficient stock
        const insufficientStockSamples = stockCheckResults.filter(result => 
          result.requiredQuantity > 0 && !result.hasEnoughStock
        );
        
        if (insufficientStockSamples.length > 0) {
          // Get product details for better error messages
          const productIds = insufficientStockSamples.map(s => s.productId);
          const products = await Product.find({ _id: { $in: productIds } }).lean();
          
          const errorDetails = insufficientStockSamples.map(sample => {
            const product = products.find(p => p._id.equals(sample.productId));
            return {
              productName: product ? product.name : 'منتج غير معروف',
              available: sample.availableQuantity,
              required: sample.requiredQuantity,
              existing: sample.existingQuantity
            };
          });
          
          const errorMessages = errorDetails.map(detail => 
            `المنتج "${detail.productName}" - الكمية المتاحة: ${detail.available}، الكمية المطلوبة: ${detail.required} (الكمية الحالية: ${detail.existing})`
          );
          
          return sendError(res, 400, {
            message: '❌ لا يوجد مخزون كافي للعينات التالية:',
            details: errorMessages,
            insufficientStockSamples: errorDetails
          });
        }

        // Process stock changes - we only need to process samples that are:
        // 1. New samples (full quantity)
        // 2. Existing samples with increased quantity (only the difference)
        // 3. Existing samples with decreased quantity (only the difference)
        await Promise.all(stockCheckResults.map(async (result) => {
          const { sample, requiredQuantity, isNewSample } = result;
          
          if (requiredQuantity === 0) {
            return; // No change in quantity, skip
          }

          const action = requiredQuantity > 0 ? 'deduct' : 'return';
          const quantityChange = Math.abs(requiredQuantity);
          
          await RepProductStock.findOneAndUpdate(
            { companyId, repId: userId, productId: sample.productId },
            { $inc: { quantity: action === 'deduct' ? -quantityChange : quantityChange } },
            { upsert: true }
          );
          
          await RepStockHistory.create({
            companyId,
            repId: userId,
            productId: sample.productId,
            quantityChange: action === 'deduct' ? -quantityChange : quantityChange,
            reason: isNewSample 
              ? 'New sample added to report' 
              : (action === 'deduct' 
                ? 'Sample quantity increased in report' 
                : 'Sample quantity decreased in report'),
            addedBy: userId,
            includeInAnalysis: false
          });
        }));

        // Update or create samples
        const bulkOps = validSamples.map(sample => ({
          updateOne: {
            filter: { _id: sample._id || new mongoose.Types.ObjectId() },
            update: { 
              $set: {
                companyId,
                takenBy: userId,
                productId: sample.productId,
                quantity: sample.quantity,
                type: sample.type,
                reportId: report._id,
                notes: sample.notes || '',
                ...(sample.type === 'customer' && { customerId: sample.customerId })
              }
            },
            upsert: true
          }
        }));

        await Sample.bulkWrite(bulkOps);
      }

      return sendSuccess(res, 200, '✅ تم تحديث التقرير بنجاح بواسطة المدير', {
        report: report.toObject()
      });
    }

    return sendError(res, 403, '🚫 غير مصرح لك بهذا الإجراء');
  } catch (error) {
    console.error('❌ Error in createOrUpdateReport:', error);
    return sendError(res, 500, '❌ خطأ في الخادم الداخلي');
  }
};

// Enhanced getReports to include customer code
const getReports = async (req, res) => {
  try {
    const { userId, role, companyId } = req.user;
    const {
      startDate,
      endDate,
      dateRange,
      repId,
      page = 1,
      limit = 10,
      sortBy = 'date',
      sortOrder = 'desc',
      customerName
    } = req.query;

    // Base query - always filter by company
    const query = { companyId };

    // Authorization logic
    if (role === 'sales') {
      query.repId = userId;
      
      if (repId && repId !== userId.toString()) {
        return sendError(res, 403, '🚫 لا يمكنك الوصول إلى تقارير مندوبين آخرين');
      }
    } else if (role === 'admin') {
      if (repId) {
        if (!mongoose.Types.ObjectId.isValid(repId)) {
          return sendError(res, 400, 'معرف المندوب غير صالح');
        }
        
        const repExists = await User.exists({
          _id: repId,
          companyId,
          role: 'sales'
        });
        
        if (!repExists) {
          return sendError(res, 403, '🚫 المندوب المطلوب غير موجود أو لا ينتمي لشركتك');
        }
        
        query.repId = repId;
      }
    }

    const today = now().format('YYYY-MM-DD');
    if (dateRange) {
      if (dateRange === 'today') {
        query.date = { $eq: today };
      } else if (dateRange === 'week') {
        const weekAgo = now().subtract(7, 'day').format('YYYY-MM-DD');
        query.date = { $gte: weekAgo, $lte: today };
      } else if (dateRange === 'month') {
        const monthAgo = now().subtract(30, 'day').format('YYYY-MM-DD');
        query.date = { $gte: monthAgo, $lte: today };
      }
    } else if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = parseWithTZ(startDate).format('YYYY-MM-DD');
      if (endDate) query.date.$lte = parseWithTZ(endDate).format('YYYY-MM-DD');
    }

    let sort = {};
    if (sortBy === 'visits') {
      sort = null;
    } else {
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    }

    let reportsQuery = DailyReport.find(query)
      .populate({
        path: 'repId',
        match: { companyId },
        select: '_id fullName name email'
      })
      .populate({
        path: 'visits.customerId',
        match: { companyId },
        select: '_id fullName phone isActive customer_code'
      })
      .lean();

    if (sort) reportsQuery = reportsQuery.sort(sort);

    const allReports = await reportsQuery;

    let sortedReports = allReports;
    if (sortBy === 'visits') {
      sortedReports = allReports.sort((a, b) => {
        const countA = (a.visits || []).filter(v => v.status === 'visited').length;
        const countB = (b.visits || []).filter(v => v.status === 'visited').length;
        const diff = countA - countB;
        return sortOrder === 'asc' ? diff : -diff;
      });
    }

    if (customerName) {
      const lowerName = customerName.toLowerCase();
      sortedReports = sortedReports.filter(report =>
        report.visits?.some(visit =>
          visit.customerId?.fullName?.toLowerCase().includes(lowerName)
      ));
    }

    const totalReports = sortedReports.length;
    const totalPages = Math.ceil(totalReports / limit);
    const currentPage = Math.max(1, parseInt(page));
    const skip = (currentPage - 1) * limit;
    const paginatedReports = sortedReports.slice(skip, skip + parseInt(limit));

    const sentToday = await DailyReport.exists({
      companyId,
      repId: role === 'sales' ? userId : (repId ? repId : null),
      date: today
    });

    // Format reports with customer code
    const formattedReports = paginatedReports.map(report => ({
      id: report._id,
      companyId: report.companyId,
      representative: report.repId ? {
        id: report.repId._id,
        name: report.repId.name,
        fullName: report.repId.fullName || report.repId.name || report.repId.email?.split('@')[0],
        email: report.repId.email
      } : null,
      repId: report.repId?._id || null,
      date: report.date,
      day: report.day,
      notes: report.notes,
      stats: report.stats,
      visits: report.visits.map(visit => {
        const customer = visit.customerId;
        return {
          id: visit._id,
          customerId: customer?._id || null,
          customerCode: visit.customer_code || customer?.customer_code || null,
          status: visit.status,
          reason: visit.reason,
          notes: visit.notes,
          duration: visit.duration,
          isExtra: visit.isExtra,
          customer: customer ? {
            id: customer._id,
            name: customer.isActive ? customer.fullName : '[Deleted Customer]',
            phone: customer.isActive ? customer.phone : null,
            isActive: customer.isActive,
            customer_code: customer.customer_code || null
          } : null
        };
      }),
      createdAt: report.createdAt,
      updatedAt: report.updatedAt
    }));

    return res.status(200).json({
      success: true,
      data: {
        page: currentPage,
        limit: Number(limit),
        totalReports,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
        sentToday: !!sentToday,
        reports: formattedReports
      }
    });

  } catch (error) {
    console.error('[GET REPORTS ERROR]', error);
    return sendError(res, 500, 'Internal server error');
  }
};

function getPublicIdFromUrl(url) {
  // تفصل الرابط على '/' وتحصل على الجزء بعد 'upload' مباشرة
  const parts = url.split('/');
  // index اللي فيه كلمة 'upload'
  const uploadIndex = parts.findIndex(part => part === 'upload');
  // publicId هي كل الأجزاء بعد upload (مع استبعاد نسخة 'vXXXX')
  const publicIdParts = parts.slice(uploadIndex + 2); // +1 للتجاوز 'upload' و +1 لتجاوز نسخة 'vXXXX'
  // نضمهم مع بعض ونزيل الامتداد
  const fullPublicId = publicIdParts.join('/');
  // نحذف الامتداد
  return fullPublicId.replace(/\.[^/.]+$/, '');
}

const deleteReportByAdmin = async (req, res) => {
  try {
    const { role, companyId, userId, username } = req.user;
    const { id: reportId } = req.params;

    if (role !== 'admin') {
      return sendError(res, 403, '🚫 فقط المدير يمكنه حذف التقارير');
    }

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return sendError(res, 400, '📛 معرف التقرير غير صالح');
    }

    // 1. Find the report first to get images before deletion
    const reportToDelete = await DailyReport.findOne({
      _id: reportId,
      companyId
    }).populate('repId', 'fullName _id');

    if (!reportToDelete) {
      return sendError(res, 404, '❌ التقرير غير موجود أو لا ينتمي لشركتك');
    }

    // 2. Delete all images from Cloudinary first
    if (reportToDelete.images && reportToDelete.images.length > 0) {
      try {
        await Promise.all(
          reportToDelete.images.map(async (imageUrl) => {
            const publicId = getPublicIdFromUrl(imageUrl);
            await deleteImage(publicId);
          })
        );
      } catch (error) {
        console.error('Error deleting report images:', error);
        // Continue with deletion even if image deletion fails
      }
    }

    // 3. Now delete the report
    const deletedReport = await DailyReport.findOneAndDelete({
      _id: reportId,
      companyId
    });

    // 4. Find all samples associated with this report
    const samples = await Sample.find({
      reportId: deletedReport._id,
      companyId
    });

    // 5. Process each sample to return stock and create history
    await Promise.all(samples.map(async (sample) => {
      // Return the quantity to stock
      await RepProductStock.findOneAndUpdate(
        {
          companyId,
          repId: deletedReport.repId,
          productId: sample.productId
        },
        { $inc: { quantity: sample.quantity } },
        { upsert: true }
      );

      // Create history entry
      await RepStockHistory.create({
        companyId,
        repId: deletedReport.repId,
        productId: sample.productId,
        quantityChange: sample.quantity,
        reason: `تم حذف العينة بسبب حذف التقرير بالكامل بواسطة المسؤول ${username}`,
        addedBy: userId,
        includeInAnalysis: false
      });
    }));

    // 6. Delete all samples associated with this report
    await Sample.deleteMany({
      reportId: deletedReport._id,
      companyId
    });

    // 7. Send notification to the rep
    if (deletedReport.repId) {
      await Notification.create({
        userId: userId,
        targetUsers: [deletedReport.repId._id],
        actionType: 'delete_report',
        level: 'warning',
        description: `تم حذف تقريرك المؤرخ بتاريخ ${deletedReport.date} بواسطة المسؤول ${username} (تم استرجاع ${samples.length} عينة)`,
        relatedEntity: {
          entityType: 'DailyReport',
          entityId: reportId
        },
        data: {
          date: deletedReport.date,
          deletedBy: username,
          deletedAt: new Date(),
          samplesRestored: samples.length,
          imagesDeleted: reportToDelete.images?.length || 0
        }
      }).catch(err => console.error('Notification error:', err));
    }

    return sendSuccess(res, 200, '✅ تم حذف التقرير بنجاح', {
      deletedReport: {
        id: deletedReport._id,
        date: deletedReport.date,
        repId: deletedReport.repId?._id,
        repName: deletedReport.repId?.fullName,
        samplesRestored: samples.length,
        imagesDeleted: reportToDelete.images?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ Error in deleteReportByAdmin:', {
      error: error.message,
      reportId: req.params.id,
      user: req.user.userId
    });
    return sendError(res, 500, '❌ خطأ في الخادم الداخلي');
  }
};

const getReportsStats = async (req, res) => {
  try {
    const { companyId } = req.user;
    const today = now().format('YYYY-MM-DD');

    const [totalSalesReps, activeRepsCount, visitsResult] = await Promise.all([
      User.countDocuments({
        companyId,
        role: 'sales',
        isActive: true
      }),

      DailyReport.countDocuments({
        companyId,
        date: today
      }),

      DailyReport.aggregate([
        {
          $match: {
            companyId: new mongoose.Types.ObjectId(companyId),
            date: today
          }
        },
        {
          $project: {
            visitedCount: {
              $size: {
                $filter: {
                  input: "$visits",
                  as: "visit",
                  cond: { $eq: ["$$visit.status", "visited"] }
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalCompletedVisits: { $sum: "$visitedCount" }
          }
        }
      ])
    ]);

    return res.status(200).json({
      success: true,
      data: {
        date: today,
        totalSalesReps,
        activeRepsCount,
        totalCompletedVisits: visitsResult[0]?.totalCompletedVisits || 0
      }
    });

  } catch (error) {
    console.error('[STATS ERROR]', error);
    return sendError(res, 500, 'Internal server error');
  }
};

module.exports = {
  createOrUpdateReport,
  deleteReportByAdmin,
  getReports,
  getReportsStats,
  getSingleReport
};