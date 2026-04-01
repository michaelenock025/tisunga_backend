// src/jobs/index.js
const cron = require('node-cron');
const { logger } = require('../utils/logger');
const { checkOverdueLoans }       = require('./loanDueAlert.job');
const { transitionEventStatuses } = require('./eventStatus.job');

function startCronJobs() {
  // Every day at 06:00 UTC (08:00 Malawi time UTC+2)
  cron.schedule('0 6 * * *', async () => {
    logger.info('[CRON] Running overdue loan checker');
    await checkOverdueLoans();
  });

  // Every day at 00:05 UTC — transition event statuses
  cron.schedule('5 0 * * *', async () => {
    logger.info('[CRON] Running event status transition');
    await transitionEventStatuses();
  });

  logger.info('Cron jobs scheduled');
}

module.exports = { startCronJobs };
