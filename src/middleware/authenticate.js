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
      where:  { id: payload.userId },
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

/* Verify active group membership */
function requireGroupMember(paramName = 'groupId') {
  return async (req, _res, next) => {
    try {
      const groupId = req.params[paramName];
      const userId  = req.user.id;

      const membership = await prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });

      if (!membership || membership.status !== 'ACTIVE') {
        throw new AppError('You are not an active member of this group', 403);
      }

      req.membership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Verify user has one of the specified roles in the group */
function requireGroupRole(...roles) {
  return async (req, _res, next) => {
    try {
      const groupId = req.params['groupId'] || req.body?.groupId;
      const userId  = req.user.id;

      const membership = await prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });

      if (!membership || membership.status !== 'ACTIVE') {
        throw new AppError('You are not an active member of this group', 403);
      }

      if (!roles.includes(membership.role)) {
        throw new AppError(
          `This action requires one of the following roles: ${roles.join(', ')}`,
          403
        );
      }

      req.membership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}


//one-group-per-user is enforced at the app level, not DB @unique).
 
async function attachMembership(req, _res, next) {
  try {
    if (req.user) {
      const membership = await prisma.groupMembership.findFirst({
        where: { userId: req.user.id, status: 'ACTIVE' },
      });
      req.membership = membership || null;
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, requireGroupMember, requireGroupRole, attachMembership };



