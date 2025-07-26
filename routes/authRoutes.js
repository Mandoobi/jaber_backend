// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { loginUser, logoutUser, verifyPassword, getLastLogin, logoutAllSessions, getAllActiveSessions, logoutSpecificSession, forceLogoutUser } = require('../controllers/authController');
const protect = require('../middleware/authMiddleware');
const checkSubscriptionStatus = require('../middleware/checkSubscriptionStatus');


router.post('/login',loginUser);

router.post('/verify-password', protect, verifyPassword );

router.post('/logout', protect, logoutUser);

router.get('/get-last-login', protect, checkSubscriptionStatus, getLastLogin);

router.get('/get-all-sessions', protect, checkSubscriptionStatus, getAllActiveSessions);

router.post('/logout-all', protect, checkSubscriptionStatus, logoutAllSessions);

router.post('/logout/specfic-session', protect, checkSubscriptionStatus, logoutSpecificSession);

router.post('/admin/force-logout', protect, checkSubscriptionStatus, forceLogoutUser);

// حماية فقط
router.get('/protected', protect, (req, res) => {
  res.status(200).json({ message: 'Access granted ✅', user: req.user });
});

module.exports = router;
