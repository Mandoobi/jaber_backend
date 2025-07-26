// middlewares/blockDeletedUsers.js

const blockDeletedUsers = (req, res, next) => {
  if (req.user?.deleted) {
    return res.status(403).json({ message: '❌ تم حذف حسابك ولا يمكنك الوصول للنظام' });

  }
  next();
};

module.exports = blockDeletedUsers;
