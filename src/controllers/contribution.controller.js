// src/controllers/contribution.controller.js
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateTransactionRef, normalizeMalawiPhone, paginate } = require('../utils/helpers');
const { paymentService } = require('../services/payment.service');
const { recordTransaction } = require('../services/transaction.service');
const { createNotification } = require('../services/notification.service');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

// POST /contributions 

async function makeContribution(req, res, next) {
  try {
    const { groupId, amount, phone, type = 'SAVINGS' } = req.body;
    const userId = req.user.id;

    if (!groupId || !amount || !phone) {
      throw new AppError('groupId, amount and phone are required', 400);
    }

    const normalized = normalizeMalawiPhone(phone);
    if (!normalized) throw new AppError('Invalid Malawi phone number', 400);

    const membership = await prisma.groupMembership.findUnique({
      where:   { groupId_userId: { groupId, userId } },
      include: { group: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new AppError('You are not an active member of this group', 403);
    }

    const minContrib = parseFloat(membership.group.minContribution.toString());
    if (parseFloat(amount) < minContrib) {
      throw new AppError(`Minimum contribution is MWK ${minContrib.toLocaleString()}`, 400);
    }

    const transactionRef = generateTransactionRef();

    // Create record first so the webhook can match it by externalRef
    const contribution = await prisma.contribution.create({
      data: {
        transactionRef,
        userId,
        groupId,
        amount:    parseFloat(amount),
        type,
        status:    'PENDING',
        phoneUsed: normalized,
      },
    });

    // Initiate payment — pawaPay sends USSD prompt to customer
    const payResult = await paymentService.collectPayment(
      normalized,
      parseFloat(amount),
      transactionRef
    );

    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        externalRef: payResult.externalRef,
        status:      payResult.status === 'FAILED' ? 'FAILED' : 'PENDING',
        ...(payResult.status === 'FAILED' && { failureReason: payResult.message }),
      },
    });

    if (payResult.status === 'FAILED') {
      throw new AppError('Payment initiation failed. Please try again.', 502);
    }

    return sendSuccess(
      res,
      { transactionRef, externalRef: payResult.externalRef },
      'Contribution initiated. Please approve the payment prompt on your phone.',
      201
    );
  } catch (err) { next(err); }
}

// GET /groups/:groupId/contributions 

async function getGroupContributions(req, res, next) {
  try {
    const { groupId } = req.params;
    const { userId: filterUserId, page = '1', limit = '20' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const contributions = await prisma.contribution.findMany({
      where:   { groupId, status: 'CONFIRMED', ...(filterUserId ? { userId: filterUserId } : {}) },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    const enriched = await Promise.all(
      contributions.map(async (c) => {
        const user = await prisma.user.findUnique({
          where:  { id: c.userId },
          select: { firstName: true, lastName: true },
        });
        return { ...c, memberName: user ? `${user.firstName} ${user.lastName}` : 'Unknown' };
      })
    );

    return sendSuccess(res, enriched);
  } catch (err) { next(err); }
}

// GET /contributions/mine 

async function myContributions(req, res, next) {
  try {
    const { page = '1', limit = '20' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const contributions = await prisma.contribution.findMany({
      where:   { userId: req.user.id },
      include: { group: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    return sendSuccess(res, contributions);
  } catch (err) { next(err); }
}

// Called by webhook handler (not an Express route) 
// Looks up by transactionRef (internal) OR externalRef (pawaPay depositId).

async function confirmContributionWebhook(transactionRef, externalRef, status, failureReason) {
  // Find by transactionRef first; fall back to externalRef (pawaPay depositId)
  let contribution;

  if (transactionRef) {
    contribution = await prisma.contribution.findUnique({
      where:   { transactionRef },
      include: { group: true, user: { select: { firstName: true, lastName: true, phone: true } } },
    });
  }

  if (!contribution && externalRef) {
    contribution = await prisma.contribution.findFirst({
      where:   { externalRef, status: 'PENDING' },
      include: { group: true, user: { select: { firstName: true, lastName: true, phone: true } } },
    });
  }

  if (!contribution || contribution.status !== 'PENDING') {
    logger.warn('confirmContributionWebhook: no matching PENDING record', { transactionRef, externalRef });
    return;
  }

  // Update contribution + group/member balances atomically
  await prisma.$transaction(async (tx) => {
    await tx.contribution.update({
      where: { id: contribution.id },
      data: {
        status: status,
        externalRef: externalRef || contribution.externalRef,
        ...(failureReason && { failureReason }),
      },
    });

    if (status === 'CONFIRMED') {
      const amount = parseFloat(contribution.amount.toString());
      await tx.group.update({
        where: { id: contribution.groupId },
        data:  { totalSavings: { increment: amount } },
      });
      await tx.groupMembership.update({
        where: { groupId_userId: { groupId: contribution.groupId, userId: contribution.userId } },
        data:  { memberSavings: { increment: amount } },
      });
    }
  });

  if (status === 'CONFIRMED') {
    const amount = parseFloat(contribution.amount.toString());

    // Ledger entry
    await recordTransaction({
      groupId:     contribution.groupId,
      userId:      contribution.userId,
      type:        'CONTRIBUTION',
      amount,
      description: `Contribution from ${contribution.user.firstName} ${contribution.user.lastName}`,
      relatedId:   contribution.id,
    });

    // In-app notification + push + SMS
    await createNotification({
      userId:  contribution.userId,
      groupId: contribution.groupId,
      type:    'CONTRIBUTION_RECEIVED',
      title:   'Contribution Confirmed',
      body:    `Your contribution of MWK ${amount.toLocaleString()} to ${contribution.group.name} was received.`,
      data:    { transactionRef: contribution.transactionRef, groupId: contribution.groupId },
    });
  }

  if (status === 'FAILED') {
    // Notify member their payment failed
    if (contribution.user?.phone) {
      await smsService.send(
        contribution.user.phone,
        `TISUNGA: Your contribution of MWK ${parseFloat(contribution.amount).toLocaleString()} to ${contribution.group.name} failed. Please try again.`
      );
    }
  }
}

module.exports = {
  makeContribution,
  getGroupContributions,
  myContributions,
  confirmContributionWebhook,
};