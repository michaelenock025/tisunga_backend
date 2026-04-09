// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateOTP, normalizeMalawiPhone } = require('../utils/helpers');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

const OTP_EXPIRY_MINUTES = 10;
const SALT_ROUNDS = 12;

//POST /auth/register
async function register(req, res, next) {
  try {
    const { phone, firstName, lastName, middleName } = req.body;

    if (!phone || !firstName || !lastName) {
      throw new AppError('phone, firstName and lastName are required', 400);
    }

    const normalized = normalizeMalawiPhone(phone);
    if (!normalized) throw new AppError('Invalid Malawi phone number', 400);

    const existing = await prisma.user.findUnique({ where: { phone: normalized } });
    if (existing?.isVerified) throw new AppError('Phone number already registered', 409);

    const user = await prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, firstName, lastName, middleName },
      update: { firstName, lastName, middleName },
    });

    await _sendOTP(user.id, normalized, 'REGISTRATION');
    return sendSuccess(res, { userId: user.id }, 'OTP sent to your phone', 201);
  } catch (err) { next(err); }
}

// POST /auth/verify-otp
async function verifyOtp(req, res, next) {
  try {
    const { userId, otp, purpose } = req.body;
    if (!userId || !otp || !purpose) throw new AppError('userId, otp and purpose are required', 400);

    const record = await prisma.oTP.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new AppError('OTP expired or not found', 400);
    if (record.attempts >= 3) throw new AppError('Too many failed attempts. Request a new OTP', 429);

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    if (record.otpHash !== otpHash) {
      await prisma.oTP.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new AppError('Invalid OTP', 400);
    }

    await Promise.all([
      prisma.oTP.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: userId }, data: { isVerified: true } }),
    ]);

    return sendSuccess(res, { verified: true }, 'Phone number verified');
  } catch (err) { next(err); }
}

//POST /auth/resend-otp
async function resendOtp(req, res, next) {
  try {
    const { userId, purpose } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    await _sendOTP(user.id, user.phone, purpose);
    return sendSuccess(res, {}, 'OTP resent');
  } catch (err) { next(err); }
}

// POST /auth/set-password
async function setPassword(req, res, next) {
  try {
    const { userId, password } = req.body;
    if (!password || password.length < 8) throw new AppError('Password must be at least 8 characters', 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isVerified) throw new AppError('User not found or not verified', 400);

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    const tokens = await _issueTokens(user.id, user.phone);
    return sendSuccess(res, tokens, 'Password set successfully');
  } catch (err) { next(err); }
}

// POST /auth/login 
async function login(req, res, next) {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) throw new AppError('phone and password are required', 400);

    const normalized = normalizeMalawiPhone(phone);
    if (!normalized) throw new AppError('Invalid phone number', 400);

    const user = await prisma.user.findUnique({ where: { phone: normalized } });
    if (!user || !user.passwordHash) throw new AppError('Invalid credentials', 401);
    if (!user.isVerified) throw new AppError('Phone number not verified', 403);
    if (!user.isActive)  throw new AppError('Account is deactivated', 403);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError('Invalid credentials', 401);

    const tokens = await _issueTokens(user.id, user.phone);
    return sendSuccess(
      res,
      { ...tokens, user: { id: user.id, firstName: user.firstName, phone: user.phone } },
      'Login successful'
    );
  } catch (err) { next(err); }
}

//POST /auth/refresh 
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token required', 400);

    const payload  = verifyRefreshToken(refreshToken);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const stored   = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    await prisma.refreshToken.delete({ where: { tokenHash } });
    const tokens = await _issueTokens(payload.userId, payload.phone);
    return sendSuccess(res, tokens, 'Token refreshed');
  } catch (err) { next(err); }
}

//POST /auth/forgot-password 
async function forgotPassword(req, res, next) {
  try {
    const { phone } = req.body;
    const normalized = normalizeMalawiPhone(phone);
    if (!normalized) throw new AppError('Invalid phone number', 400);

    const user = await prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) return sendSuccess(res, {}, 'If that number is registered, an OTP has been sent');

    await _sendOTP(user.id, user.phone, 'FORGOT_PASSWORD');
    return sendSuccess(res, { userId: user.id }, 'OTP sent to your phone');
  } catch (err) { next(err); }
}

// POST /auth/reset-password 
async function resetPassword(req, res, next) {
  try {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) throw new AppError('Password must be at least 8 characters', 400);

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await prisma.refreshToken.deleteMany({ where: { userId } });

    return sendSuccess(res, {}, 'Password reset successfully');
  } catch (err) { next(err); }
}

//  POST /auth/logout 
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await prisma.refreshToken.deleteMany({ where: { tokenHash } });
    }
    return sendSuccess(res, {}, 'Logged out');
  } catch (err) { next(err); }
}

//Private helpers 
async function _sendOTP(userId, phone, purpose) {
  const otp     = generateOTP();
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.oTP.create({ data: { userId, otpHash, purpose, expiresAt } });

  const message = `Your TISUNGA verification code is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`;
  await smsService.send(phone, message);
  logger.info(`OTP sent for ${purpose}`, { userId });
}

async function _issueTokens(userId, phone) {
  const accessToken  = signAccessToken({ userId, phone });
  const refreshToken = signRefreshToken({ userId, phone });
  const tokenHash    = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  return { accessToken, refreshToken };
}

module.exports = {
  register, verifyOtp, resendOtp, setPassword,
  login, refresh, forgotPassword, resetPassword, logout,
};
