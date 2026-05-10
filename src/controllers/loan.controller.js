// src/controllers/loan.controller.js
const prisma = require('../config/prisma');
const { AppError, sendSuccess } = require('../utils/AppError');
const {
  calculateLoanRepayable, calculateDueDate,
  generateTransactionRef, repaymentPercent, paginate,
} = require('../utils/helpers');
const { paymentService } = require('../services/payment.service');
const { recordTransaction } = require('../services/transaction.service');
const { createNotification, notifyGroupMembers } = require('../services/notification.service');
const { smsService } = require('../services/sms.service');
const { logger } = require('../utils/logger');

const DEFAULT_INTEREST_RATE = 5;

//  POST /loans/apply 

async function applyForLoan(req, res, next) {
  try {
    const { groupId, amount, durationMonths, purpose } = req.body;
    const borrowerId = req.user.id;

    if (!groupId || !amount || !durationMonths) {
      throw new AppError('groupId, amount and durationMonths are required', 400);
    }

    const principal = parseFloat(amount);
    const months    = parseInt(durationMonths);

    const membership = await prisma.groupMembership.findUnique({
      where:   { groupId_userId: { groupId, userId: borrowerId } },
      include: { group: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new AppError('You are not an active member of this group', 403);
    }

    const activeLoan = await prisma.loan.findFirst({
      where: { borrowerId, groupId, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } },
    });
    if (activeLoan) {
      throw new AppError('You already have an active or pending loan in this group', 409);
    }

    const groupBalance = parseFloat(membership.group.totalSavings.toString());
    if (principal > groupBalance) {
      throw new AppError('Insufficient group savings for this loan amount', 400);
    }

    const totalRepayable = calculateLoanRepayable(principal, DEFAULT_INTEREST_RATE);

    const loan = await prisma.loan.create({
      data: {
        transactionRef:  generateTransactionRef(),
        borrowerId, groupId,
        principalAmount: principal,
        interestRate:    DEFAULT_INTEREST_RATE,
        totalRepayable,
        remainingBalance: totalRepayable,
        durationMonths:   months,
        purpose:          purpose || null,
        status:           'PENDING',
      },
    });

    // Notify all other group members (in-app + SMS)
    await notifyGroupMembers({
      groupId,
      excludeUserId: borrowerId,
      type:  'GENERAL',
      title: 'New Loan Application',
      body:  `A member has applied for a loan of MWK ${principal.toLocaleString()}.`,
      data:  { loanId: loan.id, groupId },
    });

    return sendSuccess(res, loan, 'Loan application submitted', 201);
  } catch (err) { next(err); }
}

//  POST /loans/:loanId/approve ─

async function approveLoan(req, res, next) {
  try {
    const { loanId } = req.params;
    const approverId = req.user.id;

    const loan = await prisma.loan.findUnique({
      where:   { id: loanId },
      include: {
        group:    true,
        borrower: { select: { phone: true, firstName: true, lastName: true } },
      },
    });
    if (!loan)                     throw new AppError('Loan not found', 404);
    if (loan.status !== 'PENDING') throw new AppError('Loan is not pending approval', 400);

    const membership = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId: loan.groupId, userId: approverId } },
    });
    if (!membership || !['CHAIR', 'SECRETARY'].includes(membership.role)) {
      throw new AppError('Only the Chair or Secretary can approve loans', 403);
    }

    const principal = parseFloat(loan.principalAmount.toString());
    const dueDate   = calculateDueDate(new Date(), loan.durationMonths);
    const transactionRef = generateTransactionRef();

    // Update loan status + deduct from group balance atomically
    await prisma.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id: loanId },
        data:  { status: 'ACTIVE', approverId, approvedAt: new Date(), disbursedAt: new Date(), dueDate },
      });
      await tx.group.update({
        where: { id: loan.groupId },
        data:  { totalSavings: { decrement: principal } },
      });
    });

    // Disburse via pawaPay — USSD push to borrower's phone
    const payResult = await paymentService.disburse(
      loan.borrower.phone, principal, transactionRef
    );

    if (payResult.status === 'FAILED') {
      // Roll back the balance change since disbursement didn't go through
      await prisma.$transaction(async (tx) => {
        await tx.loan.update({ where: { id: loanId }, data: { status: 'APPROVED' } });
        await tx.group.update({ where: { id: loan.groupId }, data: { totalSavings: { increment: principal } } });
      });
      throw new AppError('Disbursement failed. Loan reverted to APPROVED. Please retry.', 502);
    }

    // Ledger entry
    await recordTransaction({
      groupId:     loan.groupId,
      userId:      loan.borrowerId,
      type:        'LOAN_DISBURSEMENT',
      amount:      principal,
      description: `Loan disbursed to ${loan.borrower.firstName} ${loan.borrower.lastName}`,
      relatedId:   loan.id,
    });

    // In-app notification + push + SMS
    await createNotification({
      userId:  loan.borrowerId,
      groupId: loan.groupId,
      type:    'LOAN_APPROVED',
      title:   'Loan Approved & Disbursed!',
      body:    `Your loan of MWK ${principal.toLocaleString()} has been approved and is being sent to your phone. Due: ${dueDate.toDateString()}.`,
      data:    { loanId: loan.id },
    });

    return sendSuccess(
      res,
      { loanId, dueDate, disbursementRef: payResult.externalRef },
      'Loan approved and disbursement initiated'
    );
  } catch (err) { next(err); }
}

//  POST /loans/:loanId/reject 

async function rejectLoan(req, res, next) {
  try {
    const { loanId } = req.params;
    const { reason } = req.body;

    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan)                     throw new AppError('Loan not found', 404);
    if (loan.status !== 'PENDING') throw new AppError('Loan is not pending', 400);

    await prisma.loan.update({
      where: { id: loanId },
      data:  { status: 'REJECTED', rejectedReason: reason, approverId: req.user.id },
    });

    await createNotification({
      userId:  loan.borrowerId,
      groupId: loan.groupId,
      type:    'LOAN_REJECTED',
      title:   'Loan Application Rejected',
      body:    reason || 'Your loan application was not approved by the group.',
      data:    { loanId },
    });

    return sendSuccess(res, {}, 'Loan rejected');
  } catch (err) { next(err); }
}

//  POST /loans/:loanId/repay ─

async function repayLoan(req, res, next) {
  try {
    const { loanId }      = req.params;
    const { amount, phone } = req.body;
    const userId = req.user.id;

    if (!amount || !phone) throw new AppError('amount and phone are required', 400);

    const loan = await prisma.loan.findUnique({
      where:   { id: loanId },
      include: { group: true },
    });
    if (!loan)                      throw new AppError('Loan not found', 404);
    if (loan.borrowerId !== userId)  throw new AppError('This is not your loan', 403);
    if (loan.status !== 'ACTIVE')   throw new AppError('Loan is not active', 400);

    const repayAmount = parseFloat(amount);
    const remaining   = parseFloat(loan.remainingBalance.toString());
    if (repayAmount > remaining) {
      throw new AppError(`Amount exceeds remaining balance of MWK ${remaining.toLocaleString()}`, 400);
    }

    const transactionRef = generateTransactionRef();
    const normalized     = phone.startsWith('+') ? phone : `+265${phone.replace(/^0/, '')}`;

    const repayment = await prisma.loanRepayment.create({
      data: { loanId, transactionRef, amount: repayAmount, status: 'PENDING' },
    });

    const payResult = await paymentService.collectPayment(normalized, repayAmount, transactionRef);

    await prisma.loanRepayment.update({
      where: { id: repayment.id },
      data: {
        status:      payResult.status === 'FAILED' ? 'FAILED' : 'PENDING',
        externalRef: payResult.externalRef,
      },
    });

    if (payResult.status === 'FAILED') {
      throw new AppError('Payment initiation failed', 502);
    }

    return sendSuccess(
      res,
      { transactionRef, externalRef: payResult.externalRef },
      'Repayment initiated. Please approve the payment prompt on your phone.',
      201
    );
  } catch (err) { next(err); }
}

//  GET /loans/mine 

async function myLoans(req, res, next) {
  try {
    const loans = await prisma.loan.findMany({
      where:   { borrowerId: req.user.id },
      include: {
        group:      { select: { name: true } },
        approver:   { select: { firstName: true, lastName: true } },
        repayments: { where: { status: 'CONFIRMED' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = loans.map((l) => ({
      ...l,
      percentRepaid: repaymentPercent(
        parseFloat(l.totalRepayable.toString()),
        parseFloat(l.remainingBalance.toString())
      ),
      approverName: l.approver ? `${l.approver.firstName} ${l.approver.lastName}` : null,
    }));

    return sendSuccess(res, result);
  } catch (err) { next(err); }
}

//  GET /groups/:groupId/loans 

async function getGroupLoans(req, res, next) {
  try {
    const { groupId } = req.params;
    const { status, page = '1', limit = '20' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const loans = await prisma.loan.findMany({
      where:   { groupId, ...(status ? { status: status.toUpperCase() } : {}) },
      include: {
        borrower: { select: { firstName: true, lastName: true, phone: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    const result = loans.map((l) => ({
      ...l,
      percentRepaid: repaymentPercent(
        parseFloat(l.totalRepayable.toString()),
        parseFloat(l.remainingBalance.toString())
      ),
      borrowerName: `${l.borrower.firstName} ${l.borrower.lastName}`,
    }));

    return sendSuccess(res, result);
  } catch (err) { next(err); }
}

//  Called by webhook handler ─

async function confirmRepaymentWebhook(transactionRef, status) {
  const repayment = await prisma.loanRepayment.findUnique({
    where:   { transactionRef },
    include: {
      loan: {
        include: {
          group:    true,
          borrower: { select: { firstName: true, lastName: true, phone: true } },
        },
      },
    },
  });

  if (!repayment || repayment.status !== 'PENDING') return;

  await prisma.$transaction(async (tx) => {
    await tx.loanRepayment.update({ where: { transactionRef }, data: { status } });

    if (status === 'CONFIRMED') {
      const repayAmount = parseFloat(repayment.amount.toString());
      const newBalance  = parseFloat(repayment.loan.remainingBalance.toString()) - repayAmount;
      const isCompleted = newBalance <= 0;

      await tx.loan.update({
        where: { id: repayment.loanId },
        data:  { remainingBalance: Math.max(0, newBalance), status: isCompleted ? 'COMPLETED' : 'ACTIVE' },
      });
      // Repayment returns money to the group pool
      await tx.group.update({
        where: { id: repayment.loan.groupId },
        data:  { totalSavings: { increment: repayAmount } },
      });
    }
  });

  if (status === 'CONFIRMED') {
    const repayAmount  = parseFloat(repayment.amount.toString());
    const remaining    = parseFloat(repayment.loan.remainingBalance.toString()) - repayAmount;
    const isCompleted  = remaining <= 0;
    const borrowerName = `${repayment.loan.borrower.firstName} ${repayment.loan.borrower.lastName}`;

    await recordTransaction({
      groupId:     repayment.loan.groupId,
      userId:      repayment.loan.borrowerId,
      type:        'LOAN_REPAYMENT',
      amount:      repayAmount,
      description: `Loan repayment from ${borrowerName}`,
      relatedId:   repayment.loanId,
    });

    // Notification + SMS to borrower
    const message = isCompleted
      ? `TISUNGA: Your loan is fully repaid. Thank you!`
      : `TISUNGA: Repayment of MWK ${repayAmount.toLocaleString()} received. Remaining: MWK ${Math.max(0, remaining).toLocaleString()}.`;

    await createNotification({
      userId:  repayment.loan.borrowerId,
      groupId: repayment.loan.groupId,
      type:    'GENERAL',
      title:   isCompleted ? 'Loan Fully Repaid!' : 'Repayment Received',
      body:    message,
      data:    { loanId: repayment.loanId },
    });
  }

  if (status === 'FAILED' && repayment.loan.borrower?.phone) {
    await smsService.send(
      repayment.loan.borrower.phone,
      `TISUNGA: Your loan repayment of MWK ${parseFloat(repayment.amount).toLocaleString()} failed. Please try again.`
    );
  }
}

module.exports = {
  applyForLoan, approveLoan, rejectLoan,
  repayLoan, myLoans, getGroupLoans,
  confirmRepaymentWebhook,
};