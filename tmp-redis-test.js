require('dotenv').config();
const Redis = require('ioredis');
const url = process.env.REDIS_URL || 'redis://localhost:6379';
console.log('REDIS_URL=', url);
const redis = new Redis(url);
redis.on('connect', () => {
  console.log('CONNECTED');
  redis.quit().then(() => process.exit(0));
});
redis.on('error', (err) => {
  console.error('ERROR', err);
  process.exit(1);
});
