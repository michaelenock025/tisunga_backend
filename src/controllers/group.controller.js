// src/controllers/group.controller.js
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateGroupCode, paginate } = require('../utils/helpers');
const { createNotification, notifyGroupMembers } = require('../services/notification.service');

async function createGroup(req, res, next) {
  try {
    const {
      name, description, location,
      minContribution, savingPeriodMonths, maxMembers, visibility,
      startDate, endDate, meetingDay, meetingTime,
    } = req.body;

    if (!name || !minContribution || !savingPeriodMonths || !maxMembers) {
      throw new AppError('name, minContribution, savingPeriodMonths and maxMembers are required', 400);
    }

    const chairId = req.user.id;
    let groupCode, exists;
    do {
      groupCode = generateGroupCode();
      exists = await prisma.group.findUnique({ where: { groupCode } });
    } while (exists);

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name, description, location, groupCode,
          minContribution: parseFloat(minContribution),
          savingPeriodMonths: parseInt(savingPeriodMonths),
          maxMembers: parseInt(maxMembers),
          visibility: visibility || 'PUBLIC',
          startDate: startDate ? new Date(startDate) : undefined,
          endDate:   endDate   ? new Date(endDate)   : undefined,
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

async function discoverGroups(req, res, next) {
  try {
    const { q, location, filter, page = '1', limit = '20' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const groups = await prisma.group.findMany({
      where: {
        visibility: 'PUBLIC',
        isActive: true,
        ...(q        ? { name:     { contains: q,        mode: 'insensitive' } } : {}),
        ...(location ? { location: { contains: location, mode: 'insensitive' } } : {}),
        ...(filter === 'short' ? { savingPeriodMonths: { lte: 3 } } : {}),
      },
      include: { _count: { select: { memberships: true } } },
      take, skip,
      orderBy: { createdAt: 'desc' },
    });

    const result = groups.map((g) => ({
      ...g,
      memberCount: g._count.memberships,
      spotsLeft:   g.maxMembers - g._count.memberships,
      isFull:      g._count.memberships >= g.maxMembers,
    }));

    return sendSuccess(res, result);
  } catch (err) { next(err); }
}

async function myGroups(req, res, next) {
  try {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId: req.user.id, status: 'ACTIVE' },
      include: { group: { include: { _count: { select: { memberships: true } } } } },
    });

    const result = memberships.map((m) => ({
      groupId:     m.group.id,
      groupName:   m.group.name,
      role:        m.role,
      totalSavings: m.group.totalSavings,
      mySavings:   m.memberSavings,
      memberCount: m.group._count.memberships,
      isActive:    m.group.isActive,
      joinedAt:    m.joinedAt,
    }));

    return sendSuccess(res, result);
  } catch (err) { next(err); }
}

async function getGroup(req, res, next) {
  try {
    const group = await prisma.group.findUnique({
      where: { id: req.params.groupId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!group) throw new AppError('Group not found', 404);
    return sendSuccess(res, group);
  } catch (err) { next(err); }
}

async function getGroupDashboard(req, res, next) {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const [group, membership, recentTransactions, activeLoans, upcomingEvents] =
      await Promise.all([
        prisma.group.findUnique({ where: { id: groupId }, include: { _count: { select: { memberships: true } } } }),
        prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } }),
        prisma.transaction.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 5 }),
        prisma.loan.count({ where: { groupId, status: 'ACTIVE' } }),
        prisma.event.findMany({ where: { groupId, status: { in: ['ACTIVE', 'UPCOMING'] } }, take: 3, orderBy: { eventDate: 'asc' } }),
      ]);

    if (!group) throw new AppError('Group not found', 404);

    return sendSuccess(res, {
      group: {
        id: group.id, name: group.name, totalSavings: group.totalSavings,
        memberCount: group._count.memberships, meetingDay: group.meetingDay,
        meetingTime: group.meetingTime, groupCode: group.groupCode, endDate: group.endDate,
      },
      mySavings: membership?.memberSavings ?? 0,
      myRole:    membership?.role ?? null,
      recentTransactions, activeLoans, upcomingEvents,
    });
  } catch (err) { next(err); }
}

async function joinByCode(req, res, next) {
  try {
    const { groupCode } = req.body;
    const userId = req.user.id;

    if (!groupCode) throw new AppError('groupCode is required', 400);

    const group = await prisma.group.findUnique({ where: { groupCode } });
    if (!group) throw new AppError('Group not found. Check the code and try again', 404);
    if (!group.isActive) throw new AppError('This group is no longer active', 400);

    const memberCount = await prisma.groupMembership.count({ where: { groupId: group.id, status: 'ACTIVE' } });
    if (memberCount >= group.maxMembers) throw new AppError('This group is full', 400);

    const existing = await prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId: group.id, userId } } });
    if (existing) throw new AppError('You are already a member of this group', 409);

    const pending = await prisma.joinRequest.findFirst({ where: { groupId: group.id, userId, status: 'PENDING' } });
    if (pending) throw new AppError('Join request already pending', 409);

    const joinRequest = await prisma.joinRequest.create({ data: { groupId: group.id, userId } });

    const chair = await prisma.groupMembership.findFirst({ where: { groupId: group.id, role: 'CHAIR' } });
    if (chair) {
      await createNotification({
        userId: chair.userId, groupId: group.id,
        type: 'MEMBER_JOINED', title: `New Join Request — ${group.name}`,
        body: 'A new member has requested to join your group.',
      });
    }

    return sendSuccess(res, joinRequest, 'Join request sent', 201);
  } catch (err) { next(err); }
}

async function getJoinRequests(req, res, next) {
  try {
    const { groupId } = req.params;
    const requests = await prisma.joinRequest.findMany({
      where: { groupId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = await Promise.all(
      requests.map(async (r) => {
        const user = await prisma.user.findUnique({
          where: { id: r.userId },
          select: { id: true, firstName: true, lastName: true, phone: true },
        });
        return { ...r, user };
      })
    );

    return sendSuccess(res, enriched);
  } catch (err) { next(err); }
}

async function handleJoinRequest(req, res, next) {
  try {
    const { groupId, reqId } = req.params;
    const { action, reason } = req.body;

    if (!['approve', 'reject'].includes(action)) throw new AppError('action must be approve or reject', 400);

    const joinRequest = await prisma.joinRequest.findFirst({ where: { id: reqId, groupId, status: 'PENDING' } });
    if (!joinRequest) throw new AppError('Join request not found', 404);

    if (action === 'approve') {
      await prisma.$transaction([
        prisma.joinRequest.update({ where: { id: reqId }, data: { status: 'APPROVED' } }),
        prisma.groupMembership.create({ data: { groupId, userId: joinRequest.userId, role: 'MEMBER', status: 'ACTIVE' } }),
      ]);
      await createNotification({
        userId: joinRequest.userId, groupId,
        type: 'MEMBER_JOINED', title: 'Join Request Approved',
        body: 'Your request to join the group has been approved. Welcome!',
      });
    } else {
      await prisma.joinRequest.update({ where: { id: reqId }, data: { status: 'REJECTED', rejectedReason: reason } });
      await createNotification({
        userId: joinRequest.userId, groupId,
        type: 'GENERAL', title: 'Join Request Rejected',
        body: reason || 'Your join request was not approved.',
      });
    }

    return sendSuccess(res, {}, `Join request ${action}d`);
  } catch (err) { next(err); }
}

async function getMembers(req, res, next) {
  try {
    const { groupId } = req.params;
    const { page = '1', limit = '50' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const memberships = await prisma.groupMembership.findMany({
      where: { groupId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      take, skip,
    });

    const enriched = await Promise.all(
      memberships.map(async (m) => {
        const user = await prisma.user.findUnique({
          where: { id: m.userId },
          select: { id: true, firstName: true, lastName: true, phone: true, avatarUrl: true },
        });
        return { ...m, user };
      })
    );

    return sendSuccess(res, enriched);
  } catch (err) { next(err); }
}

async function updateMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;
    const { role, status } = req.body;

    const membership = await prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!membership) throw new AppError('Member not found', 404);

    const updated = await prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId } },
      data: { ...(role && { role }), ...(status && { status }) },
    });

    return sendSuccess(res, updated, 'Member updated');
  } catch (err) { next(err); }
}

async function removeMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;
    if (userId === req.user.id) throw new AppError('You cannot remove yourself', 400);

    await prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId } },
      data: { status: 'INACTIVE' },
    });

    return sendSuccess(res, {}, 'Member removed');
  } catch (err) { next(err); }
}

async function updateGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    const { name, description, location, minContribution, meetingDay, meetingTime } = req.body;

    const group = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(location && { location }),
        ...(minContribution && { minContribution: parseFloat(minContribution) }),
        ...(meetingDay  && { meetingDay }),
        ...(meetingTime && { meetingTime }),
      },
    });

    return sendSuccess(res, group, 'Group updated');
  } catch (err) { next(err); }
}

module.exports = {
  createGroup, discoverGroups, myGroups, getGroup, getGroupDashboard,
  joinByCode, getJoinRequests, handleJoinRequest,
  getMembers, updateMember, removeMember, updateGroup,
};
