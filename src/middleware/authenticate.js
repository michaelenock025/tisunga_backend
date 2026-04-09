// src/middleware/authenticate.js
const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('../utils/AppError');
const prisma = require('../config/prisma');

/* Verify JWT and attach req.user */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = header.split(' ')[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, phone: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('User not found or inactive', 401);
    }

    req.user = { id: user.id, phone: user.phone };
    next();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError('Invalid token', 401));
  }
}

function requireGroupMember(paramName = 'groupId') {
  return async (req, _res, next) => {
    try {
      const groupId = req.params[paramName];
      const userId = req.user.id;

      const membership = await prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });

      if (!membership || membership.status !== 'ACTIVE') {
        throw new AppError('You are not an active member of this group', 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}


function requireGroupRole(...roles) {
  return async (req, _res, next) => {
    try {
      const groupId = req.params['groupId'] || req.body?.groupId;
      const userId = req.user.id;

      const membership = await prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });

      if (!membership || !roles.includes(membership.role)) {
        throw new AppError(
          `This action requires one of the following roles: ${roles.join(', ')}`,
          403
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, requireGroupMember, requireGroupRole };
