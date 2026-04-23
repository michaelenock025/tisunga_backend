// src/controllers/event.controller.js
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const { generateTransactionRef, paginate } = require('../utils/helpers');
const { paymentService } = require('../services/payment.service');
const { recordTransaction } = require('../services/transaction.service');
const { createNotification, notifyGroupMembers } = require('../services/notification.service');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

async function createEvent(req, res, next) {
  try {
    const { groupId } = req.params;
    const { title, type, eventDate, contributionType, fixedAmount, description } = req.body;

    if (!title || !type || !eventDate) throw new AppError('title, type and eventDate are required', 400);

    const event = await prisma.event.create({
      data: {
        groupId, title, type,
        eventDate:        new Date (eventDate),
        contributionType: contributionType || 'FLEXIBLE',
        fixedAmount:      fixedAmount ? parseFloat(fixedAmount) : undefined,
        description,
        status:           new Date(eventDate) > new Date() ? 'UPCOMING' : 'ACTIVE',
      },
    });

    await notifyGroupMembers({
      groupId,
      excludeUserId: req.user.id,
      type:  'EVENT_CREATED',
      title: `New Event: ${title}`,
      body:  `A new ${type.toLowerCase()} event has been created in your group.`,
      data:  { eventId: event.id, groupId },
    });

    return sendSuccess(res, event, 'Event created', 201);
  } catch (err) { next(err); }
}

async function getGroupEvents(req, res, next) {
  try {
    const { groupId } = req.params;
    const { status, page = '1', limit = '20' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const events = await prisma.event.findMany({
      where:   { groupId, ...(status ? { status: status.toUpperCase() } : {}) },
      include: { _count: { select: { contributions: true } } },
      orderBy: { eventDate: 'asc' },
      take, skip,
    });

    return sendSuccess(res, events);
  } catch (err) { next(err); }
}

async function getEvent(req, res, next) {
  try {
    const event = await prisma.event.findUnique({
      where:   { id: req.params.eventId },
      include: {
        contributions: {
          where:   { status: 'CONFIRMED' },
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!event) throw new AppError('Event not found', 404);
    return sendSuccess(res, event);
  } catch (err) { next(err); }
}

async function contributeToEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    const { amount, phone } = req.body;
    const userId = req.user.id;

    if (!amount || !phone) throw new AppError('amount and phone are required', 400);

    const event = await prisma.event.findUnique({
      where:   { id: eventId },
      include: { group: true },
    });
    if (!event)                    throw new AppError('Event not found', 404);
    if (event.status === 'CLOSED') throw new AppError('This event is closed', 400);

    const contribution = parseFloat(amount);

    if (event.contributionType === 'SAVINGS' && event.fixedAmount) {
      if (contribution < parseFloat(event.fixedAmount.toString())) {
        throw new AppError(`Minimum contribution is MWK ${event.fixedAmount}`, 400);
      }
    }

    const transactionRef = generateTransactionRef();
    const normalized     = phone.startsWith('+') ? phone : `+265${phone.replace(/^0/, '')}`;

    // Create record before payment so webhook can match by externalRef
    const eventContrib = await prisma.eventContribution.create({
      data: { eventId, userId, transactionRef, amount: contribution, status: 'PENDING' },
    });

    const payResult = await paymentService.collectPayment(normalized, contribution, transactionRef);

    // Store externalRef (pawaPay depositId) — critical for webhook matching
    await prisma.eventContribution.update({
      where: { id: eventContrib.id },
      data: {
        externalRef: payResult.externalRef,
        status:      payResult.status === 'FAILED' ? 'FAILED' : 'PENDING',
      },
    });

    if (payResult.status === 'FAILED') throw new AppError('Payment initiation failed', 502);

    return sendSuccess(
      res,
      { transactionRef, externalRef: payResult.externalRef },
      'Event contribution initiated. Approve the prompt on your phone.',
      201
    );
  } catch (err) { next(err); }
}

// ── Called by webhook handler ─────────────────────────────────────────────────
// Supports lookup by transactionRef (internal) OR externalRef (pawaPay depositId)

async function confirmEventContribWebhook(transactionRef, status) {
  let contrib;

  if (transactionRef) {
    contrib = await prisma.eventContribution.findUnique({
      where:   { transactionRef },
      include: {
        event: { include: { group: true } },
        user:  { select: { firstName: true, lastName: true, phone: true } },
      },
    });
  }

  if (!contrib) {
    // Fallback: look up by externalRef if transactionRef not found
    // (webhook controller may pass transactionRef = externalRef in some paths)
    contrib = await prisma.eventContribution.findFirst({
      where:   { externalRef: transactionRef, status: 'PENDING' },
      include: {
        event: { include: { group: true } },
        user:  { select: { firstName: true, lastName: true, phone: true } },
      },
    });
  }

  if (!contrib || contrib.status !== 'PENDING') return;

  await prisma.eventContribution.update({
    where: { id: contrib.id },
    data:  { status },
  });

  if (status === 'CONFIRMED') {
    const amount = parseFloat(contrib.amount.toString());

    await prisma.event.update({
      where: { id: contrib.eventId },
      data:  { raisedSoFar: { increment: amount } },
    });

    await recordTransaction({
      groupId:     contrib.event.groupId,
      userId:      contrib.userId,
      type:        'EVENT_CONTRIBUTION',
      amount,
      description: `Event contribution: ${contrib.event.title}`,
      relatedId:   contrib.eventId,
    });

    // In-app + push + SMS
    await createNotification({
      userId:  contrib.userId,
      groupId: contrib.event.groupId,
      type:    'CONTRIBUTION_RECEIVED',
      title:   'Event Contribution Confirmed',
      body:    `Your contribution of MWK ${amount.toLocaleString()} toward "${contrib.event.title}" was received.`,
      data:    { eventId: contrib.eventId },
    });
  }

  if (status === 'FAILED' && contrib.user?.phone) {
    await smsService.send(
      contrib.user.phone,
      `TISUNGA: Your event contribution of MWK ${parseFloat(contrib.amount).toLocaleString()} for "${contrib.event.title}" failed. Please try again.`
    );
  }
}


// ── PATCH /events/:eventId/close ─────────────────────────────────────────────
async function closeEvent(req, res, next) {
  try {
    const { eventId } = req.params;

    const event = await prisma.event.findUnique({ where: { id: parseInt(eventId) } });
    if (!event) throw new AppError('Event not found', 404);
    if (event.status === 'CLOSED') throw new AppError('Event is already closed', 400);

    const updated = await prisma.event.update({
      where: { id: parseInt(eventId) },
      data:  { status: 'CLOSED' },
    });

    return sendSuccess(res, updated, 'Event closed');
  } catch (err) { next(err); }
}

module.exports = {
  createEvent, getGroupEvents, getEvent,
  contributeToEvent, confirmEventContribWebhook, closeEvent,
};