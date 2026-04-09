// src/routes/group.routes.js
const { Router } = require('express');
const { authenticate, requireGroupMember, requireGroupRole } = require('../middleware/authenticate');
const {
  createGroup, discoverGroups, myGroups, getGroup, getGroupDashboard,
  joinByCode, getJoinRequests, handleJoinRequest,
  getMembers, updateMember, removeMember, updateGroup,
} = require('../controllers/group.controller');
//const { getGroupContributions } = require('../controllers/contribution.controller');
//const { getGroupLoans }         = require('../controllers/loan.controller');
//const { getGroupEvents, createEvent } = require('../controllers/event.controller');
//const { getGroupTransactions }  = require('../controllers/transaction.controller');

const router = Router();
router.use(authenticate);

// No membership needed
router.get('/discover',                        discoverGroups);
router.get('/my',                              myGroups);
router.post('/',                               createGroup);
router.post('/join',                           joinByCode);

// Membership required
router.get('/:groupId',                        requireGroupMember(), getGroup);
router.patch('/:groupId',                      requireGroupRole('CHAIR'), updateGroup);
router.get('/:groupId/dashboard',              requireGroupMember(), getGroupDashboard);

// Members
router.get('/:groupId/members',                requireGroupMember(), getMembers);
router.patch('/:groupId/members/:userId',      requireGroupRole('CHAIR'), updateMember);
router.delete('/:groupId/members/:userId',     requireGroupRole('CHAIR'), removeMember);

// Join requests (Chair/Secretary)
router.get('/:groupId/join-requests',          requireGroupRole('CHAIR', 'SECRETARY'), getJoinRequests);
router.patch('/:groupId/join-requests/:reqId', requireGroupRole('CHAIR', 'SECRETARY'), handleJoinRequest);

/*// Sub-resources
router.get('/:groupId/contributions',          requireGroupMember(), getGroupContributions);
router.get('/:groupId/loans',                  requireGroupMember(), getGroupLoans);
router.get('/:groupId/transactions',           requireGroupMember(), getGroupTransactions);
router.get('/:groupId/events',                 requireGroupMember(), getGroupEvents);
router.post('/:groupId/events',                requireGroupRole('CHAIR', 'SECRETARY'), createEvent);
*/
module.exports = router;
