const Subscription = require('../models/Subscription');
const Company = require('../models/Company');
const { now, parseWithTZ } = require('../utils/dayjs');

const createSubscription = async (req, res) => {
  try {
    const { companyId, tier, startDate, endDate, maxUsers } = req.body;

    // تحقق من وجود الشركة
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // تحديث الاشتراك السابق لو فيه
    if (company.subscription) {
      await Subscription.findByIdAndUpdate(company.subscription, { status: 'expired' });
    }

    // إنشاء الاشتراك الجديد
    const subscription = await Subscription.create({
      companyId,
      tier,
      startDate,
      endDate,
      maxUsers
    });

    // ربطه بالشركة
    company.subscription = subscription._id;
    await company.save();

    res.status(201).json(subscription);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getCurrentSubscription = async (req, res) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(400).json({ 
        success: false,
        message: "Company ID is required." 
      });
    }

    // Find active subscription directly (instead of populating)
    const activeSubscription = await Subscription.findOne({
      companyId,
      status: 'active',
      startDate: { $lte: now().toDate() },
      endDate: { $gte: now().toDate() }
    });

    if (!activeSubscription) {
      // Check for expired subscriptions
      const expiredSub = await Subscription.findOne({
        companyId,
        status: 'active',
        endDate: { $lt: now().toDate() }
      }).sort({ endDate: -1 });

      if (expiredSub) {
        return res.status(401).json({
          success: false,
          message: `Your subscription expired on ${parseWithTZ(expiredSub.endDate).format('YYYY-MM-DD')}`,
          action: "UPGRADE_REQUIRED"
        });
      }

      return res.status(401).json({ 
        success: false,
        message: 'No active subscription found',
        action: "SUBSCRIBE_NOW" 
      });
    }

    // Format response
    const subscription = {
      ...activeSubscription.toObject(),
      startDate: parseWithTZ(activeSubscription.startDate).format(),
      endDate: parseWithTZ(activeSubscription.endDate).format(),
      isActive: true
    };

    res.status(200).json({ success: true, subscription });
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch subscription',
      error: error.message 
    });
  }
};

module.exports = {
  createSubscription,
  getCurrentSubscription
};