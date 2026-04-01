// src/services/notification.service.js
const prisma = require('../config/prisma');
const { logger } = require('../utils/logger');

async function sendPush(fcmToken, payload) {
  if (process.env.NODE_ENV !== 'production') {
    logger.info(`[MOCK PUSH] ${payload.title}: ${payload.body}`);
    return;
  }
  try {
    const admin = require('firebase-admin');
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    logger.warn('FCM push failed', err);
  }
}

async function createNotification({ userId, groupId, type, title, body, data }) {
  const [notification, user] = await Promise.all([
    prisma.notification.create({
      data: { userId, groupId, type, title, body, data },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    }),
  ]);

  if (user?.fcmToken) {
    await sendPush(user.fcmToken, { title, body, data });
  }

  return notification;
}

async function notifyGroupMembers({ groupId, excludeUserId, type, title, body, data }) {
  const memberships = await prisma.groupMembership.findMany({
    where: {
      groupId,
      status: 'ACTIVE',
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });

  await Promise.all(
    memberships.map((m) =>
      createNotification({ userId: m.userId, groupId, type, title, body, data })
    )
  );
}

module.exports = { createNotification, notifyGroupMembers };
