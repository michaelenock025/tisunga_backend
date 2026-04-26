// src/index.js
require('dotenv').config();
const app = require('./app');
const { logger } = require('./utils/logger');
const { connectRedis } = require('./config/redis');
const { startCronJobs } = require('./jobs');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await connectRedis();
    logger.info('Redis connected');

    startCronJobs();
    logger.info('Cron jobs started');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`TISUNGA API running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

bootstrap();
