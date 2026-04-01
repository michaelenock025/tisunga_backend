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


module.exports = { authenticate };
