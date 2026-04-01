// src/routes/auth.routes.js
const { Router } = require('express');
const { authRateLimiter, otpRateLimiter } = require('../middleware/rateLimiter');
const {
  register, verifyOtp, resendOtp, setPassword,
  login, refresh, forgotPassword, resetPassword, logout,
} = require('../controllers/auth.controller');

const router = Router();

router.post('/register',        authRateLimiter, register);
router.post('/verify-otp',      otpRateLimiter,  verifyOtp);
router.post('/resend-otp',      otpRateLimiter,  resendOtp);
router.post('/set-password',    authRateLimiter, setPassword);
router.post('/login',           authRateLimiter, login);
router.post('/refresh',                          refresh);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password',  authRateLimiter, resetPassword);
router.post('/logout',                           logout);

module.exports = router;
