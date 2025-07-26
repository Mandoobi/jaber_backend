// utils/indexList.js

module.exports = [
  {
    name: 'customers',
    model: require('../models/Customer'),
    indexes: [
      { key: { companyId: 1 }, options: {} },
      { key: { companyId: 1, fullName: 1 }, options: {} },
      { key: { companyId: 1, city: 1 }, options: {} }
    ]
  },
  {
    name: 'orders',
    model: require('../controllers/un-use/Order'),
    indexes: [
      { key: { companyId: 1 }, options: {} },
      { key: { companyId: 1, customerId: 1 }, options: {} },
      { key: { companyId: 1, status: 1 }, options: {} },
      { key: { companyId: 1, createdAt: -1 }, options: {} }
    ]
  },
  {
    name: 'users',
    model: require('../models/User'),
    indexes: [
      { key: { username: 1 }, options: { unique: true } },
      { key: { companyId: 1 }, options: {} }
    ]
  },

  {
    name: 'products',
    model: require('../controllers/un-use/Product'),
    indexes: [
      { key: { companyId: 1 }, options: {} },
      { key: { companyId: 1, name: 1 }, options: {} },
      { key: { companyId: 1, category: 1 }, options: {} },
      { key: { companyId: 1, isActive: 1 }, options: {} },
      { key: { companyId: 1, price: 1 }, options: {} }
    ]
  },
  {
    name: 'companies',
    model: require('../models/Company'),
    indexes: [
      { key: { name: 1 }, options: { unique: true } }
    ]
  },
  {
    name: 'counters',
    model: require('../models/Counter'),
    indexes: [
      { key: { companyId: 1 }, options: { unique: true } }
    ]
  },
  {
    name: 'loginlogs',
    model: require('../models/LoginLog'),
    indexes: []
  },
  {
    name: 'visitPlans',
    model: require('../models/VisitPlan'),
    indexes: [
      { key: { repId: 1, companyId: 1, weekStartDate: 1 }, options: { unique: true } },
      { key: { companyId: 1 }, options: {} },
      { key: { companyId: 1, repId: 1 }, options: {} }
    ]
  },
  {
  name: 'dailyReports',
  model: require('../models/DailyReport'),
  indexes: [
    { key: { _id: 1 }, options: { unique: true } }, // الافتراضي موجود
    { key: { companyId: 1 }, options: {} },
    { key: { companyId: 1, repId: 1 }, options: {} },
    { key: { companyId: 1, date: 1 }, options: {} },
    { key: { companyId: 1, repId: 1, date: 1 }, options: {} }
    ]
  }
];
