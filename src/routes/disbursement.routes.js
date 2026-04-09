// src/routes/disbursement.routes.js
// Disbursements are also accessible via /groups/:groupId/disbursements (see group.routes.js)
// This provides direct access for Treasurer notification deep-links.
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { getDisbursement } = require('../controllers/disbursement.controller');

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /disbursements/{disbursementId}:
 *   get:
 *     summary: Get a disbursement by ID
 *     tags: [Disbursements]
 */
router.get('/:disbursementId', getDisbursement);

module.exports = router;
