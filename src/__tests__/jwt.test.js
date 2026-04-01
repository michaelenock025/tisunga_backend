// src/__tests__/jwt.test.js
process.env.JWT_ACCESS_SECRET  = 'test_access_secret_tisunga';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_tisunga';

const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } = require('../utils/jwt');

const payload = { userId: 'user-uuid-123', phone: '+265882752624' };

describe('JWT tokens', () => {
  describe('Access token', () => {
    it('signs and verifies a valid access token', () => {
      const token   = signAccessToken(payload);
      expect(typeof token).toBe('string');
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.phone).toBe(payload.phone);
    });

    it('throws on tampered access token', () => {
      const token = signAccessToken(payload);
      expect(() => verifyAccessToken(token + 'tampered')).toThrow();
    });
  });

  describe('Refresh token', () => {
    it('signs and verifies a valid refresh token', () => {
      const token   = signRefreshToken(payload);
      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe(payload.userId);
    });

    it('access token cannot be verified with refresh secret', () => {
      const token = signAccessToken(payload);
      expect(() => verifyRefreshToken(token)).toThrow();
    });
  });
});
