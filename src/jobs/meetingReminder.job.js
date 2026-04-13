// src/jobs/meetingReminder.job.js  — NEW in v2
// Runs every hour. Sends reminder SMS 24h before each scheduled meeting.

const prisma = require('../config/prisma');
const { smsService } = require('../services/sms.service');
const { notifyGroupMembers } = require('../services/notification.service');
const { logger } = require('../utils/logger');

async function sendMeetingReminders() {
  const now         = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23h from now
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25h from now

  // Find meetings scheduled in the 24h window that haven't had a reminder recently
  const upcomingMeetings = await prisma.meeting.findMany({
    where: {
      status:      'SCHEDULED',
      scheduledAt: { gte: windowStart, lte: windowEnd },
      // Only remind if first notification was >22h ago (avoids double-sending on hourly runs)
      notifiedAt: { lt: new Date(now.getTime() - 22 * 60 * 60 * 1000) },
    },
    include: {
      group: { select: { id: true, name: true } },
    },
  });

  for (const meeting of upcomingMeetings) {
    try {
      // Get all active members
      const memberships = await prisma.groupMembership.findMany({
        where: { groupId: meeting.groupId, status: 'ACTIVE' },
        include: { user: { select: { id: true, firstName: true, phone: true } } },
      });

      const dateStr = new Date(meeting.scheduledAt).toLocaleString('en-MW', {
        weekday: 'long', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });

      const msg =
        `TISUNGA Reminder: Meeting "${meeting.title}" in ${meeting.group.name} ` +
        `is TOMORROW at ${dateStr}` +
        (meeting.location ? ` — Location: ${meeting.location}` : '') +
        `. Please attend.`;

      const phones = memberships.map((m) => m.user.phone);
      await smsService.sendBulk(phones, msg).catch((e) => logger.warn('Bulk SMS failed', e));

      // In-app push
      await notifyGroupMembers({
        groupId: meeting.groupId,
        type:    'MEETING_REMINDER',
        title:   `Tomorrow: ${meeting.title}`,
        body:    `Meeting at ${dateStr}${meeting.location ? ` — ${meeting.location}` : ''}.`,
        data:    { meetingId: meeting.id },
      });

      // Update notifiedAt so we don't re-send on the next hourly run
      await prisma.meeting.update({
        where: { id: meeting.id },
        data:  { notifiedAt: now },
      });

      logger.info(`[CRON] 24h reminder sent for meeting ${meeting.id} to ${phones.length} members`);
    } catch (err) {
      logger.error(`[CRON] Meeting reminder failed for ${meeting.id}`, err);
    }
  }

  if (upcomingMeetings.length === 0) {
    logger.info('[CRON] No meetings require a reminder right now');
  }
}

module.exports = { sendMeetingReminders };
