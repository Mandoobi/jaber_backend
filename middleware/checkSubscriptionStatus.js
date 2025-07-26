const Subscription = require('../models/Subscription');
const { now, parseWithTZ } = require('../utils/dayjs');

const checkSubscriptionStatus = async (req, res, next) => {
  try {
    // Get companyId from req.user (not req.company)
    const companyId = req.user?.companyId || req.params.companyId || req.body.companyId;

    if (!companyId) {
      return res.status(400).json({ 
        success: false,
        message: "Company ID is required. Either authenticate or provide companyId." 
      });
    }

    // Get current time in Palestine timezone
    const currentDate = now().toDate();

    // Find the latest active subscription
    const subscription = await Subscription.findOne({
      companyId,
      status: 'active',
      startDate: { $lte: currentDate }, // Subscription has started
      endDate: { $gte: currentDate }     // Subscription has not expired
    }).sort({ createdAt: -1 });

    if (!subscription) {
      const expiredSub = await Subscription.findOne({ companyId })
        .sort({ endDate: -1 });

      if (expiredSub) {
        // Format the expired date in Palestine timezone
        const expiredDate = parseWithTZ(expiredSub.endDate).format('YYYY-MM-DD');
        
        return res.status(401).json({
          success: false,
          message: `Your subscription expired on ${expiredDate}`,
          action: "UPGRADE_REQUIRED"
        });
      }

      return res.status(401).json({
        success: false,
        message: "No subscription found. Please choose a plan.",
        action: "SUBSCRIBE_NOW"
      });
    }

    // Convert dates to Palestine timezone for consistency
    subscription.startDate = parseWithTZ(subscription.startDate);
    subscription.endDate = parseWithTZ(subscription.endDate);
    
    // Attach subscription to the request
    req.subscription = subscription;
    next();
  } catch (error) {
    console.error("Subscription check error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify subscription status.",
      error: error.message
    });
  }
};

module.exports = checkSubscriptionStatus;