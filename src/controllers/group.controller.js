// src/controllers/group.controller.js  — TISUNGA v2
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateGroupCode, normalizeMalawiPhone, paginate } = require('../utils/helpers');
const { createNotification } = require('../services/notification.service');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

//  Helper: find a user's active membership (replaces findUnique({ userId })) ─
// Since userId is no longer @unique on GroupMembership, we use findFirst.
async function findMembershipByUserId(userId) {
  return prisma.groupMembership.findFirst({
    where: { userId, status: 'ACTIVE' },
  });
}

//  POST /groups

async function createGroup(req, res, next) {
  try {
    const {
      name, description, location,
      minContribution, savingPeriodMonths, maxMembers,
      startDate, endDate, meetingDay, meetingTime,
    } = req.body;

    if (!name || !minContribution || !savingPeriodMonths || !maxMembers) {
      throw new AppError('name, minContribution, savingPeriodMonths and maxMembers are required', 400);
    }

    const chairId = req.user.id;

    // One-group-per-user check
    const existingMembership = await findMembershipByUserId(chairId);
    if (existingMembership) {
      throw new AppError('You already belong to a group. A member can only be in one group at a time.', 409);
    }

    // Generate a unique group code
    let groupCode;
    let exists;
    do {
      groupCode = generateGroupCode();
      exists = await prisma.group.findUnique({ where: { groupCode } });
    } while (exists);

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name, description, location, groupCode,
          minContribution:    parseFloat(minContribution),
          savingPeriodMonths: parseInt(savingPeriodMonths),
          maxMembers:         parseInt(maxMembers),
          startDate:  startDate ? new Date(startDate) : undefined,
          endDate:    endDate   ? new Date(endDate)   : undefined,
          meetingDay, meetingTime,
        },
      });
      await tx.groupMembership.create({
        data: { groupId: g.id, userId: chairId, role: 'CHAIR', status: 'ACTIVE' },
      });
      return g;
    });

    return sendSuccess(res, group, 'Group created successfully', 201);
  } catch (err) { next(err); }
}

//  GET /groups/my-group

async function getMyGroup(req, res, next) {
  try {
    const membership = await prisma.groupMembership.findFirst({
      where:   { userId: req.user.id, status: 'ACTIVE' },
      include: {
        group: { include: { _count: { select: { memberships: true } } } },
      },
    });

    if (!membership) {
      return sendSuccess(res, null, 'User does not belong to any group');
    }

    return sendSuccess(res, {
      groupId:      membership.group.id,
      groupName:    membership.group.name,
      groupCode:    membership.group.groupCode,
      role:         membership.role,
      totalSavings: membership.group.totalSavings,
      mySavings:    membership.memberSavings,
      memberCount:  membership.group._count.memberships,
      isActive:     membership.group.isActive,
      joinedAt:     membership.joinedAt,
      group:        membership.group,
    });
  } catch (err) { next(err); }
}

//  GET /groups/:groupId ─ basic group info (for members and non-members)

async function getGroup(req, res, next) {
  try {
    const group = await prisma.group.findUnique({
      where:   { id: req.params.groupId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!group) throw new AppError('Group not found', 404);
    return sendSuccess(res, group);
  } catch (err) { next(err); }
}

//  GET /groups/:groupId/dashboard,  all info of a group for members (dashboard view)

async function getGroupDashboard(req, res, next) {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const [group, membership, recentTransactions, activeLoans, upcomingMeetings, upcomingEvents] =
      await Promise.all([
        prisma.group.findUnique({
          where:   { id: groupId },
          include: { _count: { select: { memberships: true } } },
        }),
        prisma.groupMembership.findUnique({
          where: { groupId_userId: { groupId, userId } },
        }),
        prisma.transaction.findMany({
          where:   { groupId },
          orderBy: { createdAt: 'desc' },
          take:    5,
        }),
        prisma.loan.count({ where: { groupId, status: 'ACTIVE' } }),
        prisma.meeting.findMany({
          where:   { groupId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
          orderBy: { scheduledAt: 'asc' },
          take:    2,
        }),
        prisma.event.findMany({
          where:   { groupId, status: { in: ['ACTIVE', 'UPCOMING'] } },
          orderBy: { eventDate: 'asc' },
          take:    3,
        }),
      ]);

    if (!group) throw new AppError('Group not found', 404);

    return sendSuccess(res, {
      group: {
        id:          group.id,
        name:        group.name,
        totalSavings: group.totalSavings,
        memberCount: group._count.memberships,
        meetingDay:  group.meetingDay,
        meetingTime: group.meetingTime,
        groupCode:   group.groupCode,
        endDate:     group.endDate,
      },
      mySavings:          membership?.memberSavings ?? 0,
      myRole:             membership?.role ?? null,
      recentTransactions,
      activeLoans,
      upcomingMeetings,
      upcomingEvents,
    });
  } catch (err) { next(err); }
}

//  PATCH /groups/:groupId ─

async function updateGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    const { name, description, location, minContribution, meetingDay, meetingTime, endDate } = req.body;

    const group = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name                !== undefined && { name }),
        ...(description         !== undefined && { description }),
        ...(location            !== undefined && { location }),
        ...(minContribution     !== undefined && { minContribution: parseFloat(minContribution) }),
        ...(meetingDay          !== undefined && { meetingDay }),
        ...(meetingTime         !== undefined && { meetingTime }),
        ...(endDate             !== undefined && { endDate: new Date(endDate) }),
      },
    });
    return sendSuccess(res, group, 'Group updated');
  } catch (err) { next(err); }
}

//  POST /groups/:groupId/members 

async function addMember(req, res, next) {
  try {
    const { groupId } = req.params;
    const { phone, role = 'MEMBER', firstName, lastName } = req.body;

    if (!phone) throw new AppError('phone is required', 400);

    const normalized = normalizeMalawiPhone(phone);
    if (!normalized) throw new AppError('Invalid Malawi phone number', 400);

    // Validate role
    const validRoles = ['CHAIR', 'SECRETARY', 'TREASURER', 'MEMBER'];
    const upperRole  = (role || 'MEMBER').toUpperCase();
    if (!validRoles.includes(upperRole)) {
      throw new AppError(`Role must be one of: ${validRoles.join(', ')}`, 400);
    }

    // Only one CHAIR and one TREASURER per group
    if (upperRole === 'CHAIR') {
      const existingChair = await prisma.groupMembership.findFirst({ where: { groupId, role: 'CHAIR' } });
      if (existingChair) throw new AppError('Group already has a Chair', 409);
    }
    if (upperRole === 'TREASURER') {
      const existingTreasurer = await prisma.groupMembership.findFirst({ where: { groupId, role: 'TREASURER' } });
      if (existingTreasurer) throw new AppError('Group already has a Treasurer', 409);
    }

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError('Group not found', 404);

    const memberCount = await prisma.groupMembership.count({ where: { groupId, status: 'ACTIVE' } });
    if (memberCount >= group.maxMembers) {
      throw new AppError('Group has reached maximum member capacity', 400);
    }

    // Find or create user by phone
    let user = await prisma.user.findUnique({ where: { phone: normalized } });

    if (!user) {
      if (!firstName || !lastName) {
        throw new AppError('firstName and lastName are required when adding a new phone number', 400);
      }
      user = await prisma.user.create({
        data: { phone: normalized, firstName, lastName, isVerified: false },
      });
    }

    // One-group-per-user check using findFirst
    const existingMembership = await findMembershipByUserId(user.id);
    if (existingMembership) {
      throw new AppError(`This phone number (${normalized}) already belongs to a group`, 409);
    }

    const membership = await prisma.groupMembership.create({
      data: { groupId, userId: user.id, role: upperRole, status: 'ACTIVE' },
    });

    // SMS invite — non-blocking
    const inviteMessage = `Hi ${user.firstName}, you have been added to "${group.name}" on TISUNGA as ${upperRole}. Download the app to get started.`;
    smsService.send(normalized, inviteMessage).catch((err) =>
      logger.warn('SMS invite failed', { phone: normalized, error: err.message })
    );

    // In-app notification + push (only if they have an FCM token)
    if (user.fcmToken) {
      await createNotification({
        userId:  user.id,
        groupId,
        type:    'MEMBER_JOINED',
        title:   `Welcome to ${group.name}!`,
        body:    `You have been added as ${upperRole}. Open the app to get started.`,
        skipSms: true, // already sent above
      });
    }

    return sendSuccess(res, {
      membership,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
    }, 'Member added successfully', 201);
  } catch (err) { next(err); }
}

//  GET /groups/:groupId/members ─

async function getMembers(req, res, next) {
  try {
    const { groupId } = req.params;
    const { page = '1', limit = '50' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const memberships = await prisma.groupMembership.findMany({
      where:   { groupId },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            phone: true, avatarUrl: true, isVerified: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      take, skip,
    });

    return sendSuccess(res, memberships);
  } catch (err) { next(err); }
}

//  PATCH /groups/:groupId/members/:userId ─

async function updateMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;
    const { role, status } = req.body;

    // Use the compound key — correct after schema fix
    const membership = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) throw new AppError('Member not found in this group', 404);

    // Cannot demote the only Chair
    if (membership.role === 'CHAIR' && role && role.toUpperCase() !== 'CHAIR') {
      throw new AppError('Cannot change role of the Chair. Transfer chairpersonship first.', 400);
    }

    const updated = await prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId } },
      data: {
        ...(role   && { role:   role.toUpperCase() }),
        ...(status && { status: status.toUpperCase() }),
      },
    });

    return sendSuccess(res, updated, 'Member updated');
  } catch (err) { next(err); }
}

//  DELETE /groups/:groupId/members/:userId 

async function removeMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;

    if (userId === req.user.id) throw new AppError('You cannot remove yourself', 400);

    const membership = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) throw new AppError('Member not found in this group', 404);
    if (membership.role === 'CHAIR') throw new AppError('Cannot remove the Chair', 400);

    await prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId } },
      data:  { status: 'INACTIVE' },
    });

    return sendSuccess(res, {}, 'Member removed');
  } catch (err) { next(err); }
}

//  GET /groups/search/member 

async function searchMemberByPhone(req, res, next) {
  try {
    const { phone } = req.query;
    if (!phone) throw new AppError('phone query param is required', 400);

    const normalized = normalizeMalawiPhone(phone);
    if (!normalized) throw new AppError('Invalid Malawi phone number', 400);

    const user = await prisma.user.findUnique({
      where:  { phone: normalized },
      select: { id: true, firstName: true, lastName: true, phone: true, avatarUrl: true },
    });

    if (!user) {
      return sendSuccess(res, { found: false, phone: normalized }, 'User not registered yet');
    }

    const membership = await findMembershipByUserId(user.id);
    let groupName = null;
    if (membership) {
      const group = await prisma.group.findUnique({
        where:  { id: membership.groupId },
        select: { name: true },
      });
      groupName = group?.name ?? null;
    }

    return sendSuccess(res, {
      found:          true,
      user,
      alreadyInGroup: !!membership,
      groupName,
    });
  } catch (err) { next(err); }
}

module.exports = {
  createGroup, getMyGroup, getGroup, getGroupDashboard, updateGroup,
  addMember, getMembers, updateMember, removeMember, searchMemberByPhone,
};