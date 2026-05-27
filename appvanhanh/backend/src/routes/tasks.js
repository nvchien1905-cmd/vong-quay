const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/taskController');
const auth = require('../middleware/auth');
const { requireLevel } = require('../middleware/roleGuard');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(auth);

router.get('/', ctrl.list);
router.post('/', requireLevel(2), ctrl.create);
router.get('/:id', ctrl.getOne);
router.put('/:id', requireLevel(2), ctrl.update);
router.patch('/:id/status', ctrl.updateStatus);
router.delete('/:id', requireLevel(3), ctrl.remove);
router.post('/:id/attachments', upload.single('file'), ctrl.uploadAttachment);
router.post('/:id/comments', ctrl.addComment);

module.exports = router;
