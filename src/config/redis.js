// src/config/redis.js
const Redis = require('ioredis');
const { logger } = require('../utils/logger');

let redis;

function connectRedis() {
  return new Promise((resolve, reject) => {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: (times) => {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
    });

    redis.on('connect', () => resolve());
    redis.on('error', (err) => {
      logger.error('Redis error:', err);
      reject(err);
    });
  });
}

function getRedis() {
  if (!redis) throw new Error('Redis not initialised');
  return redis;
}

module.exports = { connectRedis, getRedis };
