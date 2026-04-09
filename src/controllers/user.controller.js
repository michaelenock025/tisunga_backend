// src/controllers/user.controller.js
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');

async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, phone: true, firstName: true, lastName: true,
        middleName: true, avatarUrl: true, isVerified: true, createdAt: true,
        memberships: {
          where: { status: 'ACTIVE' },
          select: { role: true, group: { select: { id: true, name: true, groupCode: true } } },
        },
      },
    });
    if (!user) throw new AppError('User not found', 404);
    return sendSuccess(res, user);
  } catch (err) { next(err); }
}

async function updateMe(req, res, next) {
  try {
    const { firstName, lastName, middleName, fcmToken } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName  && { lastName }),
        ...(middleName !== undefined && { middleName }),
        ...(fcmToken   && { fcmToken }),
      },
      select: { id: true, phone: true, firstName: true, lastName: true, middleName: true, avatarUrl: true },
    });
    return sendSuccess(res, updated, 'Profile updated');
  } catch (err) { next(err); }
}

async function updateAvatar(req, res, next) {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);
    const avatarUrl = `/uploads/${req.file.filename}`;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true },
    });
    return sendSuccess(res, updated, 'Avatar updated');
  } catch (err) { next(err); }
}

async function updateFcmToken(req, res, next) {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) throw new AppError('FCM token required', 400);
    await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken } });
    return sendSuccess(res, {}, 'FCM token updated');
  } catch (err) { next(err); }
}

module.exports = { getMe, updateMe, updateAvatar, updateFcmToken };
