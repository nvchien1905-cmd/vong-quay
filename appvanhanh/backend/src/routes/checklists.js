const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/checklistController');
const auth = require('../middleware/auth');
const { requireLevel } = require('../middleware/roleGuard');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(auth);

router.get('/templates', ctrl.listTemplates);
router.post('/templates', requireLevel(2), ctrl.createTemplate);
router.post('/sessions', ctrl.startSession);
router.get('/sessions', ctrl.listSessions);
router.patch('/sessions/:sessionId/complete', ctrl.completeSession);
router.patch('/items/:itemId', upload.single('photo'), ctrl.updateItem);

module.exports = router;
