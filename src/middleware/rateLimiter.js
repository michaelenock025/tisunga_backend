// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');


const passThrough = (_req, _res, next) => next();

const globalRateLimiter = process.env.NODE_ENV === 'test' ? passThrough :   rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

const authRateLimiter = process.env.NODE_ENV === 'test' ? passThrough :  rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again in 1 minute' },
});

const otpRateLimiter = process.env.NODE_ENV === 'test' ? passThrough : rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests, please wait 10 minutes' },
});

const paymentRateLimiter = process.env.NODE_ENV === 'test' ? passThrough :  rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment requests, please slow down' },
});

module.exports = { globalRateLimiter, authRateLimiter, otpRateLimiter, paymentRateLimiter };
