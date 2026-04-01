// src/routes/notification.routes.js
const { Router } = require('express');
const { authenticate } = require('../middleware/authenticate');
const { getNotifications, markAllRead, markOneRead } = require('../controllers/notification.controller');

const router = Router();
router.use(authenticate);
router.get('/',                 getNotifications);
router.patch('/read-all',       markAllRead);
router.patch('/:notifId/read',  markOneRead);
module.exports = router;
