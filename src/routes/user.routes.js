// src/routes/user.routes.js
const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/authenticate');
const { getMe, updateMe, updateAvatar, updateFcmToken } = require('../controllers/user.controller');
const { myContributions } = require('../controllers/contribution.controller');
const { myLoans } = require('../controllers/loan.controller');

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

router.get('/me',               getMe);
router.patch('/me',             updateMe);
router.patch('/me/avatar',      upload.single('avatar'), updateAvatar);
router.patch('/me/fcm-token',   updateFcmToken);
router.get('/me/contributions', myContributions);
router.get('/me/loans',         myLoans);

module.exports = router;
