// src/jobs/loanDueAlert.job.js
const prisma = require('../config/prisma');
const { smsService } = require('../services/sms.service');
const { createNotification } = require('../services/notification.service');
const { logger } = require('../utils/logger');

const ALERT_DAYS_BEFORE = 7;

async function checkOverdueLoans() {
  const now = new Date();

  // ── Mark overdue ──────────────────────────────────────
  const overdueResult = await prisma.loan.updateMany({
    where: { status: 'ACTIVE', dueDate: { lt: now } },
    data:  { status: 'OVERDUE' },
  });

  if (overdueResult.count > 0) {
    logger.info(`Marked ${overdueResult.count} loans as OVERDUE`);
  }

  // ── Send due-soon reminders ───────────────────────────
  const alertDate = new Date();
  alertDate.setDate(alertDate.getDate() + ALERT_DAYS_BEFORE);

  const dueSoonLoans = await prisma.loan.findMany({
    where: { status: 'ACTIVE', dueDate: { gte: now, lte: alertDate } },
    include: {
      borrower: { select: { id: true, phone: true, firstName: true } },
      group:    { select: { name: true } },
    },
  });

  for (const loan of dueSoonLoans) {
    const daysLeft  = Math.ceil((loan.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const remaining = parseFloat(loan.remainingBalance.toString());

    const smsMessage =
      `TISUNGA: Hi ${loan.borrower.firstName}, your loan of MWK ${remaining.toLocaleString()} ` +
      `in ${loan.group.name} is due in ${daysLeft} day(s). Please repay on time.`;

    try {
      await smsService.send(loan.borrower.phone, smsMessage);
    } catch (err) {
      logger.warn(`SMS reminder failed for loan ${loan.id}`, err);
    }

    await createNotification({
      userId:  loan.borrower.id,
      groupId: loan.groupId,
      type:    'LOAN_DUE',
      title:   'Loan Repayment Reminder',
      body:    `Your loan repayment of MWK ${remaining.toLocaleString()} is due in ${daysLeft} day(s).`,
      data:    { loanId: loan.id, daysLeft: String(daysLeft) },
    });

    logger.info(`Due-soon reminder sent for loan ${loan.id} (${daysLeft} days)`);
  }
}

module.exports = { checkOverdueLoans };
