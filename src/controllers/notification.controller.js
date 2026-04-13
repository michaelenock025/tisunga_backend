// src/controllers/notification.controller.js
const prisma = require('../config/prisma');
const { sendSuccess } = require('../utils/AppError');
const { paginate } = require('../utils/helpers');

async function getNotifications(req, res, next) {
  try {
    const { page = '1', limit = '30', unreadOnly } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id, ...(unreadOnly === 'true' ? { isRead: false } : {}) },
        include: { group: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take, skip,
      }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);

    return sendSuccess(res, { notifications, unreadCount });
  } catch (err) { next(err); }
}

async function markAllRead(req, res, next) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    return sendSuccess(res, {}, 'All notifications marked as read');
  } catch (err) { next(err); }
}

async function markOneRead(req, res, next) {
  try {
    await prisma.notification.update({ where: { id: req.params.notifId }, data: { isRead: true } });
    return sendSuccess(res, {}, 'Notification marked as read');
  } catch (err) { next(err); }
}

module.exports = { getNotifications, markAllRead, markOneRead };
