// src/routes/meeting.routes.js
// Meetings are also accessible via /groups/:groupId/meetings (see group.routes.js)
// This router provides direct meeting access for notification deep-links.
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { getMeeting, getMeetingAttendance } = require('../controllers/meeting.controller');

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /meetings/{meetingId}:
 *   get:
 *     summary: Get a meeting by ID (for notification deep-links)
 *     tags: [Meetings]
 */
router.get('/:meetingId',            getMeeting);
router.get('/:meetingId/attendance', getMeetingAttendance);

module.exports = router;
