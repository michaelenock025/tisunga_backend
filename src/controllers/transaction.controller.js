// src/controllers/transaction.controller.js
const prisma = require('../config/prisma');
const { sendSuccess } = require('../utils/AppError');
const { paginate } = require('../utils/helpers');

async function getGroupTransactions(req, res, next) {
  try {
    const { groupId } = req.params;
    const { type, page = '1', limit = '30' } = req.query;
    const { take, skip } = paginate(parseInt(page), parseInt(limit));

    const transactions = await prisma.transaction.findMany({
      where: { groupId, ...(type && type !== 'ALL' ? { type: type.toUpperCase() } : {}) },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    const enriched = await Promise.all(
      transactions.map(async (t) => {
        let memberName = 'System';
        if (t.userId) {
          const user = await prisma.user.findUnique({
            where: { id: t.userId },
            select: { firstName: true, lastName: true },
          });
          if (user) memberName = `${user.firstName} ${user.lastName}`;
        }
        return { ...t, memberName };
      })
    );

    return sendSuccess(res, enriched);
  } catch (err) { next(err); }
}

module.exports = { getGroupTransactions };
