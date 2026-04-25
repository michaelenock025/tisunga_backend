// src/controllers/meeting.controller.js  — TISUNGA v2
// Meetings: Chair creates  SMS sent to all members hair marks attendance live.

const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { paginate } = require('../utils/helpers');
const { smsService } = require('../services/sms.service');
const { createNotification, notifyGroupMembers } = require('../services/notification.service');
const { logger } = require('../utils/logger');

// ── POST /groups/:groupId/meetings 
// Chair creates a meeting. All active members are notified by SMS + push.
async function createMeeting(req, res, next) {
  try {
    const { groupId } = req.params;
    const { title, agenda, location, scheduledAt } = req.body;

    if (!title || !scheduledAt) throw new AppError('title and scheduledAt are required', 400);

    const meetingDate = new Date(scheduledAt);
    if (isNaN(meetingDate.getTime())) throw new AppError('scheduledAt must be a valid ISO date string', 400);
    if (meetingDate < new Date()) throw new AppError('Meeting must be scheduled in the future', 400);

    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
    if (!group) throw new AppError('Group not found', 404);

    // Create meeting
    const meeting = await prisma.meeting.create({
      data: {
        groupId,
        createdBy: req.user.id,
        title,
        agenda,
        location,
        scheduledAt: meetingDate,
        status: 'SCHEDULED',
      },
    });

    // Pre-populate attendance records for all active members (all start as ABSENT)
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId, status: 'ACTIVE' },
      include: { user: { select: { id: true, firstName: true, phone: true, fcmToken: true } } },
    });

    await prisma.meetingAttendance.createMany({
      data: memberships.map((m) => ({
        meetingId: meeting.id,
        userId:    m.userId,
        status:    'ABSENT',
      })),
      skipDuplicates: true,
    });

    // Notify all members
    await _notifyMeetingScheduled(meeting, group.name, memberships);

    // Store when notifications were sent
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { notifiedAt: new Date() },
    });

    return sendSuccess(res, meeting, 'Meeting scheduled and members notified', 201);
  } catch (err) { next(err); }
}

// ── GET /groups/:groupId/meetings
async function getGroupMeetings(req, res, next) {
  try {
    const { groupId } = req.params;
    const { status, page = '1', limit = '20' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const meetings = await prisma.meeting.findMany({
      where: {
        groupId,
        ...(status ? { status: status.toUpperCase() } : {}),
      },
      include: {
        creator:    { select: { firstName: true, lastName: true } },
        _count:     { select: { attendance: true } },
        attendance: { select: { status: true } },
      },
      orderBy: { scheduledAt: 'desc' },
      take,
      skip,
    });

    const enriched = meetings.map((m) => {
      const presentCount = m.attendance.filter((a) => a.status === 'PRESENT').length;
      const totalCount   = m.attendance.length;
      return {
        ...m,
        presentCount,
        totalCount,
        attendancePercent: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0,
        creatorName: `${m.creator.firstName} ${m.creator.lastName}`,
      };
    });

    return sendSuccess(res, enriched);
  } catch (err) { next(err); }
}

// ── GET /groups/:groupId/meetings/:meetingId
async function getMeeting(req, res, next) {
  try {
    const { meetingId } = req.params;

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        creator: { select: { firstName: true, lastName: true } },
        attendance: true,
      },
    });

    if (!meeting) throw new AppError('Meeting not found', 404);

    // Enrich attendance with user details
    const enrichedAttendance = await Promise.all(
      meeting.attendance.map(async (a) => {
        const user = await prisma.user.findUnique({
          where: { id: a.userId },
          select: { id: true, firstName: true, lastName: true, phone: true, avatarUrl: true },
        });
        return { ...a, user };
      })
    );

    const presentCount = enrichedAttendance.filter((a) => a.status === 'PRESENT').length;
    const totalCount   = enrichedAttendance.length;

    return sendSuccess(res, {
      ...meeting,
      attendance: enrichedAttendance,
      presentCount,
      totalCount,
      attendancePercent: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0,
      creatorName: `${meeting.creator.firstName} ${meeting.creator.lastName}`,
    });
  } catch (err) { next(err); }
}

// ── PATCH /groups/:groupId/meetings/:meetingId/status ──
// Chair changes meeting status: SCHEDULED → ONGOING → COMPLETED | CANCELLED
async function updateMeetingStatus(req, res, next) {
  try {
    const { meetingId } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['ONGOING', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status?.toUpperCase())) {
      throw new AppError(`status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new AppError('Meeting not found', 404);
    if (meeting.status === 'COMPLETED') throw new AppError('Meeting is already completed', 400);
    if (meeting.status === 'CANCELLED') throw new AppError('Meeting is cancelled', 400);

    const updated = await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: status.toUpperCase(),
        ...(notes !== undefined && { notes }),
      },
    });

    return sendSuccess(res, updated, `Meeting status updated to ${status}`);
  } catch (err) { next(err); }
}

// ── PATCH /groups/:groupId/meetings/:meetingId/attendance ──
// Chair marks attendance for a single member OR submits the full attendance sheet.
// Body option A: { userId, status } — mark one member
// Body option B: { attendance: [{ userId, status, note }] } — bulk submit
async function markAttendance(req, res, next) {
  try {
    const { meetingId, groupId } = req.params;
    const chairId = req.user.id;

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new AppError('Meeting not found', 404);
    if (meeting.groupId !== groupId) throw new AppError('Meeting does not belong to this group', 400);
    if (meeting.status === 'CANCELLED') throw new AppError('Cannot mark attendance for a cancelled meeting', 400);

    const validStatuses = ['PRESENT', 'ABSENT', 'EXCUSED', 'LATE'];

    // ── Bulk submission 
    if (req.body.attendance && Array.isArray(req.body.attendance)) {
      const entries = req.body.attendance;

      // Validate all entries first
      for (const entry of entries) {
        if (!entry.userId || !entry.status) throw new AppError('Each attendance entry needs userId and status', 400);
        if (!validStatuses.includes(entry.status.toUpperCase())) {
          throw new AppError(`Invalid status "${entry.status}". Must be one of: ${validStatuses.join(', ')}`, 400);
        }
      }

      const updates = await Promise.all(
        entries.map((entry) =>
          prisma.meetingAttendance.upsert({
            where: { meetingId_userId: { meetingId, userId: entry.userId } },
            create: {
              meetingId,
              userId: entry.userId,
              status: entry.status.toUpperCase(),
              markedBy: chairId,
              markedAt: new Date(),
              note: entry.note,
            },
            update: {
              status: entry.status.toUpperCase(),
              markedBy: chairId,
              markedAt: new Date(),
              note: entry.note,
            },
          })
        )
      );

      // Auto-complete meeting if chair submits bulk attendance
      if (meeting.status === 'ONGOING') {
        await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'COMPLETED' } });
      }

      const presentCount = updates.filter((u) => u.status === 'PRESENT').length;
      return sendSuccess(res, { updated: updates.length, presentCount }, 'Attendance submitted');
    }

    // ── Single member 
    const { userId, status, note } = req.body;
    if (!userId || !status) throw new AppError('userId and status are required', 400);
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new AppError(`status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const attendance = await prisma.meetingAttendance.upsert({
      where: { meetingId_userId: { meetingId, userId } },
      create: {
        meetingId, userId,
        status: status.toUpperCase(),
        markedBy: chairId,
        markedAt: new Date(),
        note,
      },
      update: {
        status: status.toUpperCase(),
        markedBy: chairId,
        markedAt: new Date(),
        note,
      },
    });

    return sendSuccess(res, attendance, 'Attendance marked');
  } catch (err) { next(err); }
}

// ── GET /groups/:groupId/meetings/:meetingId/attendance ──
async function getMeetingAttendance(req, res, next) {
  try {
    const { meetingId } = req.params;

    const attendance = await prisma.meetingAttendance.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
    });

    const enriched = await Promise.all(
      attendance.map(async (a) => {
        const user = await prisma.user.findUnique({
          where: { id: a.userId },
          select: { id: true, firstName: true, lastName: true, phone: true, avatarUrl: true },
        });
        return { ...a, user };
      })
    );

    const summary = {
      total:   enriched.length,
      present: enriched.filter((a) => a.status === 'PRESENT').length,
      absent:  enriched.filter((a) => a.status === 'ABSENT').length,
      excused: enriched.filter((a) => a.status === 'EXCUSED').length,
      late:    enriched.filter((a) => a.status === 'LATE').length,
    };
    summary.attendancePercent = summary.total > 0
      ? Math.round(((summary.present + summary.late) / summary.total) * 100) : 0;

    return sendSuccess(res, { attendance: enriched, summary });
  } catch (err) { next(err); }
}

// ── POST /groups/:groupId/meetings/:meetingId/remind ───
// Chair sends a manual SMS reminder to members who haven't confirmed.
async function sendReminder(req, res, next) {
  try {
    const { meetingId, groupId } = req.params;

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new AppError('Meeting not found', 404);
    if (meeting.status !== 'SCHEDULED') throw new AppError('Can only send reminders for scheduled meetings', 400);

    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });

    // Get all active members
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId, status: 'ACTIVE', userId: { not: req.user.id } },
      include: { user: { select: { id: true, firstName: true, phone: true, fcmToken: true } } },
    });

    const message = _buildMeetingMessage(meeting, group.name, 'reminder');
    const phones  = memberships.map((m) => m.user.phone);

    await smsService.sendBulk(phones, message).catch((e) => logger.warn('Bulk SMS failed', e));

    // In-app notifications
    await notifyGroupMembers({
      groupId,
      excludeUserId: req.user.id,
      type:  'MEETING_REMINDER',
      title: `Reminder: ${meeting.title}`,
      body:  `Meeting scheduled for ${new Date(meeting.scheduledAt).toLocaleString()}${meeting.location ? ` at ${meeting.location}` : ''}.`,
      data:  { meetingId: meeting.id },
    });

    return sendSuccess(res, { sentTo: phones.length }, 'Reminder sent to all members');
  } catch (err) { next(err); }
}

// ── Private helpers 
function _buildMeetingMessage(meeting, groupName, type = 'scheduled') {
  const dateStr = new Date(meeting.scheduledAt).toLocaleString('en-MW', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  if (type === 'reminder') {
    return `TISUNGA Reminder: "${meeting.title}" in ${groupName} is tomorrow at ${dateStr}.${meeting.location ? ` Location: ${meeting.location}` : ''} Please attend.`;
  }

  return (
    `TISUNGA: "${meeting.title}" has been scheduled for ${groupName}.\n` +
    `Date: ${dateStr}\n` +
    (meeting.location ? `Location: ${meeting.location}\n` : '') +
    (meeting.agenda ? `Agenda: ${meeting.agenda}\n` : '') +
    `Please make every effort to attend.`
  );
}

async function _notifyMeetingScheduled(meeting, groupName, memberships) {
  const message = _buildMeetingMessage(meeting, groupName, 'scheduled');

  // SMS to all members
  const phones = memberships.map((m) => m.user.phone);
  await smsService.sendBulk(phones, message).catch((e) => logger.warn('Bulk SMS failed', e));

  // In-app push for those with FCM tokens
  await Promise.all(
    memberships.map((m) =>
      createNotification({
        userId:  m.userId,
        groupId: meeting.groupId,
        type:    'MEETING_SCHEDULED',
        title:   `New Meeting: ${meeting.title}`,
        body:    `Scheduled for ${new Date(meeting.scheduledAt).toLocaleString()}${meeting.location ? ` at ${meeting.location}` : ''}.`,
        data:    { meetingId: meeting.id },
      })
    )
  );
}

module.exports = {
  createMeeting,
  getGroupMeetings,
  getMeeting,
  updateMeetingStatus,
  markAttendance,
  getMeetingAttendance,
  sendReminder,
};
