const express = require('express');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');

// Load environment variables
dotenv.config();

// Database connection
const connectDB = require('./config/db');

// Route imports
const companyRoutes = require('./routes/companyRoutes');
const productRoutes = require('./routes/productRoutes');
const userRoutes = require('./routes/userRoutes');
const exportRoutes = require('./routes/exportRoutes');
const customerRoutes = require('./routes/customerRoutes');
const authRoutes = require('./routes/authRoutes');
const visit_plansRoutes = require('./routes/visitPlanRoutes');
const dailyReport = require('./routes/dailyReportRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const updateRoutes = require('./routes/updateRoutes');
const Notification = require('./routes/NotificationRoutes');
const Subscription = require('./routes/SubscriptionRoutes');
const Stats = require('./routes/statsRoutes');
const Permissions = require('./routes/permissionRoutes');
const repProductStockRoutes = require('./routes/repProductStockRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware

app.use(cors({
  origin: 'https://mandoobipro.netlify.app',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 123654
});
app.use(limiter);

// API Routes
app.use('/api/companies', companyRoutes);
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/visit-plans', visit_plansRoutes);
app.use('/api/daily-report', dailyReport);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/updates', updateRoutes);
app.use('/api/notification', Notification);
app.use('/api/Subscription', Subscription);
app.use('/api/stats', Stats);
app.use('/api/exports', exportRoutes);
app.use('/api/permissions', Permissions);
app.use('/api/stocks', repProductStockRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Database connection failed', err);
    process.exit(1);
  });