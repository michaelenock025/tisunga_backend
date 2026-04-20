
const { Router } = require('express');
const { authenticate, requireGroupMember, requireGroupRole } = require('../middleware/authenticate');
const { createGroup, getMyGroup, getGroup, getGroupDashboard, updateGroup, addMember, getMembers, getMemberSavings, updateMember, removeMember, searchMemberByPhone, } = require('../controllers/group.controller');
const { getGroupContributions } = require('../controllers/contribution.controller');
const { getGroupLoans }         = require('../controllers/loan.controller');
const { getGroupEvents, createEvent } = require('../controllers/event.controller');
const { getGroupTransactions }  = require('../controllers/transaction.controller');
const { createMeeting, getGroupMeetings, getMeeting, updateMeetingStatus, markAttendance, getMeetingAttendance, sendReminder,} = require('../controllers/meeting.controller');
const { requestDisbursement, getDisbursements, getDisbursement, approveDisbursement, rejectDisbursement, } = require('../controllers/disbursement.controller');

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /groups:
 *   post:
 *     summary: Create a group. Creator becomes CHAIR. User must not already be in a group.
 *     tags: [Groups]
 */
router.post('/', createGroup);

router.get('/my', getMyGroup);
router.get('/search/member', searchMemberByPhone);

//  Group-scoped routes (membership required) 
router.get('/:groupId',           requireGroupMember(), getGroup);
router.patch('/:groupId',         requireGroupRole('CHAIR'), updateGroup);
router.get('/:groupId/dashboard', requireGroupMember(), getGroupDashboard);

//  Members  (Chair manages, no self-service) 
/**
 * @swagger
 * /groups/{groupId}/members:
 *   post:
 *     summary: Chair adds a member by phone number + role. One group per user enforced.
 *     tags: [Members]
 */
router.post('/:groupId/members',               requireGroupRole('CHAIR'), addMember);
router.get('/:groupId/members',                requireGroupMember(), getMembers);
router.get('/:groupId/members/savings',        requireGroupMember(), getMemberSavings);
router.patch('/:groupId/members/:userId',      requireGroupRole('CHAIR'), updateMember);
router.delete('/:groupId/members/:userId',     requireGroupRole('CHAIR'), removeMember);

// Android app compat — old join-requests pattern mapped to addMember
router.put('/:groupId/join-requests/:userId/approve', requireGroupRole('CHAIR'), (req, res) =>
  res.json({ success: true, message: 'Use POST /groups/:id/members to add members directly' })
);

//  Transactions 
router.get('/:groupId/transactions', requireGroupMember(), getGroupTransactions);

//  Savings/Contributions 
router.get('/:groupId/contributions', requireGroupMember(), getGroupContributions);

//  Loans 
router.get('/:groupId/loans', requireGroupMember(), getGroupLoans);

//  Events 
router.get('/:groupId/events',  requireGroupMember(), getGroupEvents);
router.post('/:groupId/events', requireGroupRole('CHAIR', 'SECRETARY'), createEvent);

//  Meetings 
/**
 * @swagger
 * /groups/{groupId}/meetings:
 *   post:
 *     summary: Chair schedules a meeting. SMS sent to all active members immediately.
 *     tags: [Meetings]
 */
router.post('/:groupId/meetings',                               requireGroupRole('CHAIR', 'SECRETARY'), createMeeting);
router.get('/:groupId/meetings',                                requireGroupMember(), getGroupMeetings);
router.get('/:groupId/meetings/:meetingId',                     requireGroupMember(), getMeeting);
router.patch('/:groupId/meetings/:meetingId/status',            requireGroupRole('CHAIR', 'SECRETARY'), updateMeetingStatus);
router.patch('/:groupId/meetings/:meetingId/attendance',        requireGroupRole('CHAIR', 'SECRETARY'), markAttendance);
router.get('/:groupId/meetings/:meetingId/attendance',          requireGroupMember(), getMeetingAttendance);
router.post('/:groupId/meetings/:meetingId/remind',             requireGroupRole('CHAIR', 'SECRETARY'), sendReminder);

//  Disbursements 
/**
 * @swagger
 * /groups/{groupId}/disbursements/request:
 *   post:
 *     summary: Chair requests disbursement at end of savings cycle. Treasurer must approve.
 *     tags: [Disbursements]
 */
router.post('/:groupId/disbursements/request',                  requireGroupRole('CHAIR'), requestDisbursement);
router.get('/:groupId/disbursements',                           requireGroupMember(), getDisbursements);
router.get('/:groupId/disbursements/:disbursementId',           requireGroupMember(), getDisbursement);
router.post('/:groupId/disbursements/:disbursementId/approve',  requireGroupRole('TREASURER'), approveDisbursement);
router.post('/:groupId/disbursements/:disbursementId/reject',   requireGroupRole('TREASURER'), rejectDisbursement);

router.post('/:groupId/disburse/request', requireGroupRole('CHAIR'), requestDisbursement);
router.post('/:groupId/disburse/approve', requireGroupRole('TREASURER'), (req, res, next) => {
  // Map to first pending disbursement
  req.params.disbursementId = req.body.disbursementId;
  approveDisbursement(req, res, next);
});
router.post('/:groupId/disburse/reject', requireGroupRole('TREASURER'), (req, res, next) => {
  req.params.disbursementId = req.body.disbursementId;
  rejectDisbursement(req, res, next);
});

module.exports = router;
