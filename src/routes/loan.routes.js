// src/routes/loan.routes.js
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { paymentRateLimiter } = require('../middleware/rateLimiter');
const {
  applyForLoan, approveLoan, rejectLoan, repayLoan, myLoans, getGroupLoans,
} = require('../controllers/loan.controller');

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /loans/apply:
 *   post:
 *     summary: Member applies for a loan from their group
 *     tags: [Loans]
 */
router.post('/apply',            paymentRateLimiter, applyForLoan);
router.get('/my',                myLoans);

router.get('/group/:groupId',    getGroupLoans);
router.get('/my-loans',          myLoans);

router.patch('/:loanId/approve', approveLoan);
router.patch('/:loanId/reject',  rejectLoan);
router.post('/:loanId/repay',    paymentRateLimiter, repayLoan);

// Android compat: PUT /loans/:id/approve|reject
router.put('/:loanId/approve',   approveLoan);
router.put('/:loanId/reject',    rejectLoan);

module.exports = router;




/* src/routes/loan.routes.js
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { paymentRateLimiter } = require('../middleware/rateLimiter');
const { applyForLoan, approveLoan, rejectLoan, repayLoan, myLoans } = require('../controllers/loan.controller');

const router = Router();
router.use(authenticate);
router.post('/apply',            paymentRateLimiter, applyForLoan);
router.get('/my',                myLoans);
router.patch('/:loanId/approve', approveLoan);
router.patch('/:loanId/reject',  rejectLoan);
router.post('/:loanId/repay',    paymentRateLimiter, repayLoan);
module.exports = router;
*/