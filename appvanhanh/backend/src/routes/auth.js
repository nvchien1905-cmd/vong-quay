const router = require('express').Router();
const ctrl = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/login', ctrl.login);
router.post('/refresh', ctrl.refreshToken);
router.post('/logout', auth, ctrl.logout);
router.put('/change-password', auth, ctrl.changePassword);
router.get('/me', auth, ctrl.getMe);
router.put('/fcm-token', auth, ctrl.saveFcmToken);

module.exports = router;
