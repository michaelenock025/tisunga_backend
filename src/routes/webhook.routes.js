// src/routes/webhook.routes.js
const { Router } = require('express');
const { handlePaymentWebhook, handleAirtelWebhook, handlePawaPayWebhook  } = require('../controllers/webhook.controller');

const router = Router();

// Internal HMAC-signed webhook (your own backend-to-backend use)
router.post('/payment',   handlePaymentWebhook);

// Legacy Airtel direct callback (keep for backwards compat)
router.post('/airtel',    handleAirtelWebhook);

router.post('/pawapay',  handlePawaPayWebhook);

module.exports = router;