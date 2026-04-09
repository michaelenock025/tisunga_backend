// src/controllers/webhook.controller.js
// Handles incoming callbacks from pawaPay and internal HMAC webhooks.
//
// pawaPay callback shapes:
//   Deposit:  { depositId, status: 'COMPLETED'|'FAILED', failureReason? }
//   Payout:   { payoutId,  status: 'COMPLETED'|'FAILED', failureReason? }

const crypto = require('crypto');
const { logger } = require('../utils/logger');
const prisma = require('../config/prisma');
const { confirmContributionWebhook } = require('./contribution.controller');
const { confirmRepaymentWebhook }    = require('./loan.controller');
const { confirmEventContribWebhook } = require('./event.controller');

// helpers 

function normaliseStatus(raw) {
  const s = String(raw).toUpperCase();
  if (['COMPLETED', 'SUCCESS', 'CONFIRMED', 'TS'].includes(s)) return 'CONFIRMED';
  return 'FAILED';
}

/**
 * Look up a pending Contribution by externalRef (pawaPay depositId).
 * Returns the transactionRef so confirmContributionWebhook can find it.
 */
async function findContribRefByExternal(externalRef) {
  const record = await prisma.contribution.findFirst({
    where: { externalRef, status: 'PENDING' },
    select: { transactionRef: true },
  });
  return record?.transactionRef || null;
}

async function findRepaymentRefByExternal(externalRef) {
  const record = await prisma.loanRepayment.findFirst({
    where: { externalRef, status: 'PENDING' },
    select: { transactionRef: true },
  });
  return record?.transactionRef || null;
}

async function findEventContribRefByExternal(externalRef) {
  const record = await prisma.eventContribution.findFirst({
    where: { externalRef, status: 'PENDING' },
    select: { transactionRef: true },
  });
  return record?.transactionRef || null;
}

// pawaPay webhook 

async function handlePawaPayWebhook(req, res) {
  try {
    const body   = req.body;
    const status = normaliseStatus(body?.status);
    const reason = body?.failureReason?.failureMessage || null;

    // Deposit callback (contribution / loan repayment / event contribution) 
    if (body?.depositId) {
      const depositId = body.depositId;
      logger.info('pawaPay deposit callback', { depositId, status });

      // Look up which record owns this depositId (stored as externalRef)
      const contribRef = await findContribRefByExternal(depositId);
      if (contribRef) {
        await confirmContributionWebhook(contribRef, depositId, status, reason);
        return res.status(200).json({ received: true });
      }

      const repayRef = await findRepaymentRefByExternal(depositId);
      if (repayRef) {
        await confirmRepaymentWebhook(repayRef, status);
        return res.status(200).json({ received: true });
      }

      const eventRef = await findEventContribRefByExternal(depositId);
      if (eventRef) {
        await confirmEventContribWebhook(eventRef, status);
        return res.status(200).json({ received: true });
      }

      logger.warn('pawaPay deposit: no matching PENDING record', { depositId });
    }

    // Payout callback (loan disbursement / group disbursement) 
    if (body?.payoutId) {
      const payoutId = body.payoutId;
      logger.info('pawaPay payout callback', { payoutId, status });

      // Loan repayments can also come back as payouts if disbursed directly
      // Currently logged; extend here when you add a formal payout tracking model
      if (status === 'FAILED') {
        logger.error(`pawaPay payout FAILED | payoutId:${payoutId} | reason:${reason}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('pawaPay webhook error', err);
    return res.status(200).json({ received: true });
  }
}

//  Internal HMAC webhook (your own backend-to-backend use) 
async function handlePaymentWebhook(req, res) {
  try {
    const signature = req.headers['x-tisunga-signature'];
    const payload   = JSON.stringify(req.body);
    const expected  = `sha256=${crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(payload)
      .digest('hex')}`;

    if (!signature || signature !== expected) {
      logger.warn('Internal webhook: invalid signature');
      return res.status(200).json({ received: true, error: 'Invalid signature' });
    }

    const { transactionRef, externalRef, status, type, reason } = req.body;
    const normStatus = normaliseStatus(status);
    logger.info('Internal webhook received', { transactionRef, normStatus, type });

    switch (type) {
      case 'CONTRIBUTION':
        await confirmContributionWebhook(transactionRef, externalRef, normStatus, reason);
        break;
      case 'LOAN_REPAYMENT':
        await confirmRepaymentWebhook(transactionRef, normStatus);
        break;
      case 'EVENT_CONTRIBUTION':
        await confirmEventContribWebhook(transactionRef, normStatus);
        break;
      default:
        logger.warn('Unhandled internal webhook type', { type });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Internal webhook error', err);
    return res.status(200).json({ received: true });
  }
}

// Legacy Airtel direct callback 

async function handleAirtelWebhook(req, res) {
  try {
    const b = req.body;
    req.body = {
      transactionRef: b?.transaction?.id || b?.id,
      externalRef:    b?.transaction?.airtel_money_id,
      status:         b?.transaction?.status,
      type:           b?.transaction?.type || 'CONTRIBUTION',
      reason:         b?.transaction?.message,
    };
    return handlePaymentWebhook(req, res);
  } catch (err) {
    logger.error('Airtel webhook error', err);
    return res.status(200).json({ received: true });
  }
}

module.exports = { handlePawaPayWebhook, handlePaymentWebhook, handleAirtelWebhook };