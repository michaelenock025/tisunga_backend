// src/services/transaction.service.js
const prisma = require('../config/prisma');
const { generateTransactionRef } = require('../utils/helpers');

async function recordTransaction({ groupId, userId, type, amount, description, relatedId }) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { totalSavings: true },
  });

  const currentBalance = Number(group?.totalSavings ?? 0);
  let balanceAfter = currentBalance;

  if (['CONTRIBUTION', 'LOAN_REPAYMENT', 'EVENT_CONTRIBUTION'].includes(type)) {
    balanceAfter = currentBalance + amount;
  } else if (['LOAN_DISBURSEMENT', 'WITHDRAWAL'].includes(type)) {
    balanceAfter = currentBalance - amount;
  }

  return prisma.transaction.create({
    data: {
      tisuRef: generateTransactionRef(),
      groupId,
      userId,
      type,
      amount,
      description,
      balanceAfter,
      relatedId,
    },
  });
}

module.exports = { recordTransaction };
