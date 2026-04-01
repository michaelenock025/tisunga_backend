// src/__tests__/auth.test.js
process.env.NODE_ENV           = 'test';
process.env.JWT_ACCESS_SECRET  = 'test_access_secret';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
process.env.WEBHOOK_SECRET     = 'test_webhook_secret';
process.env.DATABASE_URL       = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tisunga_test';

const request = require('supertest');
const app     = require('../app');
const prisma  = require('../config/prisma');

const TEST_PHONE = '+265899123456';

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/register', () => {
  it('registers a new user and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: TEST_PHONE, firstName: 'Test', lastName: 'User' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('userId');
  });

  it('returns 400 for an invalid Malawi phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: '0712345678', firstName: 'Test', lastName: 'User' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when firstName is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: TEST_PHONE, lastName: 'User' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns 401 for wrong credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: TEST_PHONE, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid phone format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: 'notaphone', password: 'anything' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('always returns 200 to prevent user enumeration', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ phone: '+265899999999' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /health', () => {
  it('returns 200 with app info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.app).toBe('TISUNGA API');
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
