// src/jobs/eventStatus.job.js
const prisma = require('../config/prisma');
const { notifyGroupMembers } = require('../services/notification.service');
const { logger } = require('../utils/logger');

async function transitionEventStatuses() {
  const now = new Date();

  // ── UPCOMING → ACTIVE ─────────────────────────────────
  const toActive = await prisma.event.updateMany({
    where: { status: 'UPCOMING', eventDate: { lte: now } },
    data:  { status: 'ACTIVE' },
  });
  if (toActive.count > 0) {
    logger.info(`Transitioned ${toActive.count} events UPCOMING → ACTIVE`);
  }

  // ── ACTIVE → CLOSED (event date > 1 day ago) ──────────
  const closingDate = new Date(now);
  closingDate.setDate(closingDate.getDate() - 1);

  const nowClosing = await prisma.event.findMany({
    where:  { status: 'ACTIVE', eventDate: { lt: closingDate } },
    select: { id: true, groupId: true, title: true, raisedSoFar: true },
  });

  for (const event of nowClosing) {
    await prisma.event.update({ where: { id: event.id }, data: { status: 'CLOSED' } });

    const raised = parseFloat(event.raisedSoFar.toString());

    await notifyGroupMembers({
      groupId: event.groupId,
      type:    'EVENT_CLOSED',
      title:   `Event Closed: ${event.title}`,
      body:    `The event has ended. Total raised: MWK ${raised.toLocaleString()}.`,
      data:    { eventId: event.id },
    });

    logger.info(`Event ${event.id} closed — raised MWK ${raised}`);
  }

  if (nowClosing.length > 0) {
    logger.info(`Closed ${nowClosing.length} events ACTIVE → CLOSED`);
  }
}

module.exports = { transitionEventStatuses };
