// src/controllers/disbursement.controller.js  — TISUNGA v2
// Flow: CHAIR requests → TREASURER approves/rejects → Airtel Money pays each member.

const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { calculateMemberShares, generateTransactionRef } = require('../utils/helpers');
const { paymentService } = require('../services/payment.service');
const { recordTransaction } = require('../services/transaction.service');
const { createNotification, notifyGroupMembers } = require('../services/notification.service');
const { logger } = require('../utils/logger');

// POST /groups/:groupId/disbursements/request 
// Chair requests a disbursement when the savings cycle ends.
// Calculates each member's share and stores it.
async function requestDisbursement(req, res, next) {
  try {
    const { groupId } = req.params;
    const chairId = req.user.id;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError('Group not found', 404);
    if (!group.isActive) throw new AppError('Group is not active', 400);

    const totalSavings = parseFloat(group.totalSavings.toString());
    if (totalSavings <= 0) throw new AppError('No savings to disburse', 400);

    // Block if a disbursement is already pending
    const existingPending = await prisma.disbursement.findFirst({
      where: { groupId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (existingPending) {
      throw new AppError('A disbursement request is already pending or processing', 409);
    }

    // Calculate each member's share
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId, status: 'ACTIVE' },
      include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    });

    if (memberships.length === 0) throw new AppError('No active members found', 400);

    const shares = calculateMemberShares(memberships, totalSavings);
    const memberShares = shares.map((s) => {
      const m = memberships.find((mb) => mb.userId === s.userId);
      return {
        userId:       s.userId,
        name:         `${m.user.firstName} ${m.user.lastName}`,
        phone:        m.user.phone,
        memberSavings: s.memberSavings,
        shareAmount:  Math.round(s.shareAmount * 100) / 100,
      };
    });

    const disbursement = await prisma.disbursement.create({
      data: {
        groupId,
        requestedBy: chairId,
        totalAmount: totalSavings,
        status: 'PENDING',
        memberShares,
      },
    });

    // Notify treasurer
    const treasurer = await prisma.groupMembership.findFirst({
      where: { groupId, role: 'TREASURER', status: 'ACTIVE' },
    });
    if (treasurer) {
      await createNotification({
        userId:  treasurer.userId,
        groupId,
        type:    'DISBURSEMENT_REQUESTED',
        title:   'Disbursement Approval Needed',
        body:    `The Chair has requested disbursement of MWK ${totalSavings.toLocaleString()} to ${memberships.length} members.`,
        data:    { disbursementId: disbursement.id },
      });
    } else {
      logger.warn(`Group ${groupId} has no Treasurer — disbursement approval is pending`);
    }

    return sendSuccess(res, { disbursement, memberShares }, 'Disbursement requested. Awaiting Treasurer approval.', 201);
  } catch (err) { next(err); }
}

//GET /groups/:groupId/disbursements
async function getDisbursements(req, res, next) {
  try {
    const { groupId } = req.params;

    const disbursements = await prisma.disbursement.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
    });

    return sendSuccess(res, disbursements);
  } catch (err) { next(err); }
}

//  GET /groups/:groupId/disbursements/:disbursementId 
async function getDisbursement(req, res, next) {
  try {
    const { disbursementId } = req.params;
    const disbursement = await prisma.disbursement.findUnique({ where: { id: disbursementId } });
    if (!disbursement) throw new AppError('Disbursement not found', 404);
    return sendSuccess(res, disbursement);
  } catch (err) { next(err); }
}

//  POST /groups/:groupId/disbursements/:id/approve 
// Treasurer approves → triggers Airtel Money payout to each member's phone.
async function approveDisbursement(req, res, next) {
  try {
    const { disbursementId, groupId } = req.params;
    const treasurerId = req.user.id;

    const disbursement = await prisma.disbursement.findUnique({ where: { id: disbursementId } });
    if (!disbursement) throw new AppError('Disbursement not found', 404);
    if (disbursement.groupId !== groupId) throw new AppError('Disbursement does not belong to this group', 400);
    if (disbursement.status !== 'PENDING') throw new AppError('Disbursement is not pending approval', 400);

    // Mark as processing
    await prisma.disbursement.update({
      where: { id: disbursementId },
      data: { status: 'PROCESSING', approvedBy: treasurerId, processedAt: new Date() },
    });

    const memberShares = disbursement.memberShares;
    const errors = [];

    // Disburse to each member via mobile money
    for (const share of memberShares) {
      try {
        const ref = generateTransactionRef();
        const result = await paymentService.disburse(share.phone, share.shareAmount, ref);

        if (result.status !== 'PENDING' && result.status !== 'CONFIRMED') {
          errors.push({ userId: share.userId, name: share.name, error: result.message });
          continue;
        }

        // Record in transaction ledger
        await recordTransaction({
          groupId,
          userId: share.userId,
          type:   'DISBURSEMENT',
          amount: share.shareAmount,
          description: `Disbursement to ${share.name} — end of savings cycle`,
          relatedId: disbursementId,
        });

        // Notify the member
        await createNotification({
          userId:  share.userId,
          groupId,
          type:    'DISBURSEMENT_APPROVED',
          title:   'Savings Disbursed!',
          body:    `MWK ${share.shareAmount.toLocaleString()} has been sent to your phone ${share.phone}.`,
          data:    { disbursementId, amount: String(share.shareAmount) },
        });
      } catch (err) {
        logger.error(`Disbursement failed for ${share.name}`, err);
        errors.push({ userId: share.userId, name: share.name, error: err.message });
      }
    }

    // If all payouts initiated, deduct from group balance and mark complete
    const successCount = memberShares.length - errors.length;

    if (errors.length === 0) {
      await prisma.$transaction([
        prisma.disbursement.update({
          where: { id: disbursementId },
          data: { status: 'COMPLETED' },
        }),
        prisma.group.update({
          where: { id: groupId },
          data: { totalSavings: 0, isActive: false }, // cycle ends
        }),
        prisma.groupMembership.updateMany({
          where: { groupId },
          data: { memberSavings: 0 },
        }),
      ]);
    } else {
      await prisma.disbursement.update({
        where: { id: disbursementId },
        data: { status: errors.length === memberShares.length ? 'REJECTED' : 'COMPLETED' },
      });
    }

    return sendSuccess(res, {
      disbursementId,
      totalMembers: memberShares.length,
      successCount,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    }, errors.length === 0 ? 'Disbursement completed successfully' : 'Disbursement completed with some failures');
  } catch (err) { next(err); }
}

//  POST /groups/:groupId/disbursements/:id/reject 
async function rejectDisbursement(req, res, next) {
  try {
    const { disbursementId, groupId } = req.params;
    const { reason } = req.body;

    const disbursement = await prisma.disbursement.findUnique({ where: { id: disbursementId } });
    if (!disbursement) throw new AppError('Disbursement not found', 404);
    if (disbursement.groupId !== groupId) throw new AppError('Disbursement does not belong to this group', 400);
    if (disbursement.status !== 'PENDING') throw new AppError('Disbursement is not pending', 400);

    await prisma.disbursement.update({
      where: { id: disbursementId },
      data: { status: 'REJECTED', approvedBy: req.user.id, rejectedReason: reason },
    });

    // Notify the chair
    await createNotification({
      userId:  disbursement.requestedBy,
      groupId,
      type:    'DISBURSEMENT_REJECTED',
      title:   'Disbursement Rejected',
      body:    reason || 'The Treasurer has rejected the disbursement request.',
      data:    { disbursementId },
    });

    return sendSuccess(res, {}, 'Disbursement rejected');
  } catch (err) { next(err); }
}

module.exports = { requestDisbursement, getDisbursements, getDisbursement, approveDisbursement, rejectDisbursement, };
