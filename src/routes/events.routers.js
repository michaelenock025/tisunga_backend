// src/routes/event.routes.js
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { paymentRateLimiter } = require('../middleware/rateLimiter');
const { getEvent, contributeToEvent, closeEvent} = require('../controllers/event.controller');

const router = Router();
router.use(authenticate);
router.get('/:eventId',             getEvent);
router.post('/:eventId/contribute', paymentRateLimiter, contributeToEvent);
router.put('/:eventId/close',  closeEvent);
router.patch('/:eventId/close', closeEvent);

module.exports = router;
