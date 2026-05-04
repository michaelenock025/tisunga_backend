// src/controllers/group.controller.js  — TISUNGA v2
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateGroupCode, normalizeMalawiPhone, paginate } = require('../utils/helpers');
const { createNotification } = require('../services/notification.service');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

//  Helper: find a user's active membership
async function findMembershipByUserId(userId) {
  return prisma.groupMembership.findFirst({
    where: { userId, status: 'ACTIVE' },
  });
}

// ── Helper: compute reliable totalSavings from confirmed contributions ─────────
//
// WHY THIS EXISTS:
//   group.totalSavings is a running total that is incremented/decremented by
//   the pawaPay webhook.  In local / test environments the webhook URL is
//   typically unreachable, so contributions stay PENDING and totalSavings stays
//   0 even though members have genuinely saved.
//
//   This helper computes the real figure directly from the contributions table:
//     realTotal = SUM(confirmed contributions) - SUM(principal of active loans)
//
//   We return whichever is larger: the stored running total (correct in prod)
//   or the computed total (correct when webhook hasn't fired).
//   This is safe because both values should converge to the same number in
//   production once the webhook is working.

async function computeReliableSavings(groupId, storedTotalSavings) {
  const stored = parseFloat(storedTotalSavings?.toString() ?? '0');

  // Fast path: if the stored value is already positive, trust it.
  if (stored > 0) return stored;

  // Fallback: compute from confirmed contributions minus active loan principal
  const [contribResult, loanResult] = await Promise.all([
    prisma.contribution.aggregate({
      where: { groupId, status: 'CONFIRMED' },
      _sum:  { amount: true },
    }),
    prisma.loan.aggregate({
      where: { groupId, status: { in: ['ACTIVE'] } },
      _sum:  { principalAmount: true },
    }),
  ]);

  const totalContributed = parseFloat(contribResult._sum.amount?.toString() ?? '0');
  const totalLoaned      = parseFloat(loanResult._sum.principalAmount?.toString() ?? '0');
  const computed         = Math.max(0, totalContributed - totalLoaned);

  return Math.max(stored, computed);
}

//  GET /groups — discover public/open groups

async function getGroups(req, res, next) {
  try {
    const { page = '1', limit = '20', search = '' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const groups = await prisma.group.findMany({
      where: {
        isActive: true,
        ...(search && { name: { contains: search, mode: 'insensitive' } }),
      },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    return sendSuccess(res, groups);
  } catch (err) { next(err); }
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

    const existingMembership = await findMembershipByUserId(chairId);
    if (existingMembership) {
      throw new AppError('You already belong to a group. A member can only be in one group at a time.', 409);
    }

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

//  GET /groups/my

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

    // FIX: compute reliable totalSavings so the home screen and savings screen
    //      show the real balance even when the webhook hasn't fired yet.
    const reliableTotalSavings = await computeReliableSavings(
      membership.group.id,
      membership.group.totalSavings
    );

    // Also compute personal savings from confirmed contributions when
    // memberSavings is 0 (same webhook issue)
    const storedMySavings = parseFloat(membership.memberSavings?.toString() ?? '0');
    let reliableMySavings = storedMySavings;
    if (storedMySavings === 0) {
      const personal = await prisma.contribution.aggregate({
        where: { groupId: membership.group.id, userId: req.user.id, status: 'CONFIRMED' },
        _sum:  { amount: true },
      });
      reliableMySavings = parseFloat(personal._sum.amount?.toString() ?? '0');
    }

    return sendSuccess(res, {
      groupId:      membership.group.id,
      groupName:    membership.group.name,
      groupCode:    membership.group.groupCode,
      role:         membership.role,
      totalSavings: reliableTotalSavings,
      mySavings:    reliableMySavings,
      memberCount:  membership.group._count.memberships,
      isActive:     membership.group.isActive,
      joinedAt:     membership.joinedAt,
      group: {
        ...membership.group,
        totalSavings: reliableTotalSavings,
      },
    });
  } catch (err) { next(err); }
}

//  GET /groups/:groupId

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

//  GET /groups/:groupId/dashboard

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

    // FIX: use reliable savings computation
    const reliableTotalSavings = await computeReliableSavings(
      groupId,
      group.totalSavings
    );

    const storedMySavings = parseFloat(membership?.memberSavings?.toString() ?? '0');
    let reliableMySavings = storedMySavings;
    if (storedMySavings === 0 && membership) {
      const personal = await prisma.contribution.aggregate({
        where: { groupId, userId, status: 'CONFIRMED' },
        _sum:  { amount: true },
      });
      reliableMySavings = parseFloat(personal._sum.amount?.toString() ?? '0');
    }

    return sendSuccess(res, {
      group: {
        id:           group.id,
        name:         group.name,
        totalSavings: reliableTotalSavings,
        memberCount:  group._count.memberships,
        meetingDay:   group.meetingDay,
        meetingTime:  group.meetingTime,
        groupCode:    group.groupCode,
        endDate:      group.endDate,
      },
      mySavings:          reliableMySavings,
      myRole:             membership?.role ?? null,
      recentTransactions,
      activeLoans,
      upcomingMeetings,
      upcomingEvents,
    });
  } catch (err) { next(err); }
}

//  PATCH /groups/:groupId

async function updateGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    const { name, description, location, minContribution, meetingDay, meetingTime, endDate } = req.body;

    const group = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name            !== undefined && { name }),
        ...(description     !== undefined && { description }),
        ...(location        !== undefined && { location }),
        ...(minContribution !== undefined && { minContribution: parseFloat(minContribution) }),
        ...(meetingDay      !== undefined && { meetingDay }),
        ...(meetingTime     !== undefined && { meetingTime }),
        ...(endDate         !== undefined && { endDate: new Date(endDate) }),
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

    const validRoles = ['CHAIR', 'SECRETARY', 'TREASURER', 'MEMBER'];
    const upperRole  = (role || 'MEMBER').toUpperCase();
    if (!validRoles.includes(upperRole)) {
      throw new AppError(`Role must be one of: ${validRoles.join(', ')}`, 400);
    }

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

    let user = await prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) {
      if (!firstName || !lastName) {
        throw new AppError('firstName and lastName are required when adding a new phone number', 400);
      }
      user = await prisma.user.create({
        data: { phone: normalized, firstName, lastName, isVerified: false },
      });
    }

    const existingMembership = await findMembershipByUserId(user.id);
    if (existingMembership) {
      throw new AppError(`This phone number (${normalized}) already belongs to a group`, 409);
    }

    const membership = await prisma.groupMembership.create({
      data: { groupId, userId: user.id, role: upperRole, status: 'ACTIVE' },
    });

    const inviteMessage = `Hi ${user.firstName}, you have been added to "${group.name}" on TISUNGA as ${upperRole}. Download the app to get started.`;
    smsService.send(normalized, inviteMessage).catch((err) =>
      logger.warn('SMS invite failed', { phone: normalized, error: err.message })
    );

    if (user.fcmToken) {
      await createNotification({
        userId:  user.id,
        groupId,
        type:    'MEMBER_JOINED',
        title:   `Welcome to ${group.name}!`,
        body:    `You have been added as ${upperRole}. Open the app to get started.`,
        skipSms: true,
      });
    }

    return sendSuccess(res, {
      membership,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
    }, 'Member added successfully', 201);
  } catch (err) { next(err); }
}

//  GET /groups/:groupId/members

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

// ── GET /groups/:groupId/members/savings ───────────────────────────────────────
//
//  NEW ENDPOINT — returns each active member's personal savings amount.
//
//  The savings screen previously used the disbursement endpoint as a workaround
//  because getMembers() doesn't include memberSavings.  This is the proper fix:
//  we read memberSavings from GroupMembership directly and fall back to computing
//  it from confirmed contributions when the running total is 0 (webhook issue).

async function getMemberSavings(req, res, next) {
  try {
    const { groupId } = req.params;

    const memberships = await prisma.groupMembership.findMany({
      where:   { groupId, status: 'ACTIVE' },
      select:  {
        userId:       true,
        role:         true,
        memberSavings: true,
        user: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
      },
      orderBy: [{ role: 'asc' }, { memberSavings: 'desc' }],
    });

    // For each member whose stored memberSavings is 0, compute it from confirmed
    // contributions (handles the case where the webhook hasn't fired yet).
    const results = await Promise.all(
      memberships.map(async (m) => {
        const stored = parseFloat(m.memberSavings?.toString() ?? '0');
        let savings  = stored;

        if (stored === 0) {
          const agg = await prisma.contribution.aggregate({
            where: { groupId, userId: m.userId, status: 'CONFIRMED' },
            _sum:  { amount: true },
          });
          savings = parseFloat(agg._sum.amount?.toString() ?? '0');
        }

        return {
          userId:   m.user.id,
          userName: `${m.user.firstName} ${m.user.lastName}`.trim(),
          userPhone: m.user.phone,
          role:     m.role,
          amount:   savings,
        };
      })
    );

    // Sort by savings descending so top savers appear first
    results.sort((a, b) => b.amount - a.amount);

    return sendSuccess(res, results);
  } catch (err) { next(err); }
}

//  PATCH /groups/:groupId/members/:userId

async function updateMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;
    const { role, status } = req.body;

    const membership = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) throw new AppError('Member not found in this group', 404);

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
  getGroups, createGroup, getMyGroup, getGroup, getGroupDashboard, updateGroup,
  addMember, getMembers, getMemberSavings, updateMember, removeMember, searchMemberByPhone,
};



/*// src/controllers/group.controller.js  — TISUNGA v2
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateGroupCode, normalizeMalawiPhone, paginate } = require('../utils/helpers');
const { createNotification } = require('../services/notification.service');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

//  Helper: find a user's active membership
async function findMembershipByUserId(userId) {
  return prisma.groupMembership.findFirst({
    where: { userId, status: 'ACTIVE' },
  });
}

// ── Helper: compute reliable totalSavings from confirmed contributions ─────────
//
// WHY THIS EXISTS:
//   group.totalSavings is a running total that is incremented/decremented by
//   the pawaPay webhook.  In local / test environments the webhook URL is
//   typically unreachable, so contributions stay PENDING and totalSavings stays
//   0 even though members have genuinely saved.
//
//   This helper computes the real figure directly from the contributions table:
//     realTotal = SUM(confirmed contributions) - SUM(principal of active loans)


async function computeReliableSavings(groupId, storedTotalSavings) {
  const stored = parseFloat(storedTotalSavings?.toString() ?? '0');

  // Fast path: if the stored value is already positive, trust it.
  if (stored > 0) return stored;

  // Fallback: compute from confirmed contributions minus active loan principal
  const [contribResult, loanResult] = await Promise.all([
    prisma.contribution.aggregate({
      where: { groupId, status: 'CONFIRMED' },
      _sum:  { amount: true },
    }),
    prisma.loan.aggregate({
      where: { groupId, status: { in: ['ACTIVE'] } },
      _sum:  { principalAmount: true },
    }),
  ]);

  const totalContributed = parseFloat(contribResult._sum.amount?.toString() ?? '0');
  const totalLoaned      = parseFloat(loanResult._sum.principalAmount?.toString() ?? '0');
  const computed         = Math.max(0, totalContributed - totalLoaned);

  return Math.max(stored, computed);
}

//  GET /groups — discover public/open groups

async function getGroups(req, res, next) {
  try {
    const { page = '1', limit = '20', search = '' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const groups = await prisma.group.findMany({
      where: {
        isActive: true,
        ...(search && { name: { contains: search, mode: 'insensitive' } }),
      },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    return sendSuccess(res, groups);
  } catch (err) { next(err); }
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

    const existingMembership = await findMembershipByUserId(chairId);
    if (existingMembership) {
      throw new AppError('You already belong to a group. A member can only be in one group at a time.', 409);
    }

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

//  GET /groups/my

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

    // FIX: compute reliable totalSavings so the home screen and savings screen
    //      show the real balance even when the webhook hasn't fired yet.
    const reliableTotalSavings = await computeReliableSavings(
      membership.group.id,
      membership.group.totalSavings
    );

    // Also compute personal savings from confirmed contributions when
    // memberSavings is 0 (same webhook issue)
    const storedMySavings = parseFloat(membership.memberSavings?.toString() ?? '0');
    let reliableMySavings = storedMySavings;
    if (storedMySavings === 0) {
      const personal = await prisma.contribution.aggregate({
        where: { groupId: membership.group.id, userId: req.user.id, status: 'CONFIRMED' },
        _sum:  { amount: true },
      });
      reliableMySavings = parseFloat(personal._sum.amount?.toString() ?? '0');
    }

    return sendSuccess(res, {
      groupId:      membership.group.id,
      groupName:    membership.group.name,
      groupCode:    membership.group.groupCode,
      role:         membership.role,
      totalSavings: reliableTotalSavings,
      mySavings:    reliableMySavings,
      memberCount:  membership.group._count.memberships,
      isActive:     membership.group.isActive,
      joinedAt:     membership.joinedAt,
      group: {
        ...membership.group,
        totalSavings: reliableTotalSavings,
      },
    });
  } catch (err) { next(err); }
}

//  GET /groups/:groupId

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

//  GET /groups/:groupId/dashboard

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

    // FIX: use reliable savings computation
    const reliableTotalSavings = await computeReliableSavings(
      groupId,
      group.totalSavings
    );

    const storedMySavings = parseFloat(membership?.memberSavings?.toString() ?? '0');
    let reliableMySavings = storedMySavings;
    if (storedMySavings === 0 && membership) {
      const personal = await prisma.contribution.aggregate({
        where: { groupId, userId, status: 'CONFIRMED' },
        _sum:  { amount: true },
      });
      reliableMySavings = parseFloat(personal._sum.amount?.toString() ?? '0');
    }

    return sendSuccess(res, {
      group: {
        id:           group.id,
        name:         group.name,
        totalSavings: reliableTotalSavings,
        memberCount:  group._count.memberships,
        meetingDay:   group.meetingDay,
        meetingTime:  group.meetingTime,
        groupCode:    group.groupCode,
        endDate:      group.endDate,
      },
      mySavings:          reliableMySavings,
      myRole:             membership?.role ?? null,
      recentTransactions,
      activeLoans,
      upcomingMeetings,
      upcomingEvents,
    });
  } catch (err) { next(err); }
}

//  PATCH /groups/:groupId

async function updateGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    const { name, description, location, minContribution, meetingDay, meetingTime, endDate } = req.body;

    const group = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name            !== undefined && { name }),
        ...(description     !== undefined && { description }),
        ...(location        !== undefined && { location }),
        ...(minContribution !== undefined && { minContribution: parseFloat(minContribution) }),
        ...(meetingDay      !== undefined && { meetingDay }),
        ...(meetingTime     !== undefined && { meetingTime }),
        ...(endDate         !== undefined && { endDate: new Date(endDate) }),
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

    const validRoles = ['CHAIR', 'SECRETARY', 'TREASURER', 'MEMBER'];
    const upperRole  = (role || 'MEMBER').toUpperCase();
    if (!validRoles.includes(upperRole)) {
      throw new AppError(`Role must be one of: ${validRoles.join(', ')}`, 400);
    }

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

    let user = await prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) {
      if (!firstName || !lastName) {
        throw new AppError('firstName and lastName are required when adding a new phone number', 400);
      }
      user = await prisma.user.create({
        data: { phone: normalized, firstName, lastName, isVerified: false },
      });
    }

    const existingMembership = await findMembershipByUserId(user.id);
    if (existingMembership) {
      throw new AppError(`This phone number (${normalized}) already belongs to a group`, 409);
    }

    const membership = await prisma.groupMembership.create({
      data: { groupId, userId: user.id, role: upperRole, status: 'ACTIVE' },
    });

    const inviteMessage = `Hi ${user.firstName}, you have been added to "${group.name}" on TISUNGA as ${upperRole}. Download the app to get started.`;
    smsService.send(normalized, inviteMessage).catch((err) =>
      logger.warn('SMS invite failed', { phone: normalized, error: err.message })
    );

    if (user.fcmToken) {
      await createNotification({
        userId:  user.id,
        groupId,
        type:    'MEMBER_JOINED',
        title:   `Welcome to ${group.name}!`,
        body:    `You have been added as ${upperRole}. Open the app to get started.`,
        skipSms: true,
      });
    }

    return sendSuccess(res, {
      membership,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
    }, 'Member added successfully', 201);
  } catch (err) { next(err); }
}

//  GET /groups/:groupId/members

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

// ── GET /groups/:groupId/members/savings ───────────────────────────────────────
//
//  NEW ENDPOINT — returns each active member's personal savings amount.
//
//  The savings screen previously used the disbursement endpoint as a workaround
//  because getMembers() doesn't include memberSavings.  This is the proper fix:
//  we read memberSavings from GroupMembership directly and fall back to computing
//  it from confirmed contributions when the running total is 0 (webhook issue).

async function getMemberSavings(req, res, next) {
  try {
    const { groupId } = req.params;

    const memberships = await prisma.groupMembership.findMany({
      where:   { groupId, status: 'ACTIVE' },
      select:  {
        userId:       true,
        role:         true,
        memberSavings: true,
        user: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
      },
      orderBy: [{ role: 'asc' }, { memberSavings: 'desc' }],
    });

    // For each member whose stored memberSavings is 0, compute it from confirmed
    // contributions (handles the case where the webhook hasn't fired yet).
    const results = await Promise.all(
      memberships.map(async (m) => {
        const stored = parseFloat(m.memberSavings?.toString() ?? '0');
        let savings  = stored;

        if (stored === 0) {
          const agg = await prisma.contribution.aggregate({
            where: { groupId, userId: m.userId, status: 'CONFIRMED' },
            _sum:  { amount: true },
          });
          savings = parseFloat(agg._sum.amount?.toString() ?? '0');
        }

        return {
          userId:   m.user.id,
          userName: `${m.user.firstName} ${m.user.lastName}`.trim(),
          userPhone: m.user.phone,
          role:     m.role,
          amount:   savings,
        };
      })
    );

    // Sort by savings descending so top savers appear first
    results.sort((a, b) => b.amount - a.amount);

    return sendSuccess(res, results);
  } catch (err) { next(err); }
}

//  PATCH /groups/:groupId/members/:userId

async function updateMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;
    const { role, status } = req.body;

    const membership = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) throw new AppError('Member not found in this group', 404);

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
  getGroups, createGroup, getMyGroup, getGroup, getGroupDashboard, updateGroup,
  addMember, getMembers, getMemberSavings, updateMember, removeMember, searchMemberByPhone,
};
*/
