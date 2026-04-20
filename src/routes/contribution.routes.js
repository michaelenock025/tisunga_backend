// src/routes/contribution.routes.js
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { paymentRateLimiter } = require('../middleware/rateLimiter');
const { makeContribution, myContributions} = require('../controllers/contribution.controller');

const router = Router();
router.use(authenticate);
router.get('/my', myContributions);

router.post('/', paymentRateLimiter, makeContribution);
router.post('/group/:groupId', paymentRateLimiter, (req, res, next) => {
  req.body.groupId = req.params.groupId;
  makeContribution(req, res, next);
});

module.exports = router;
