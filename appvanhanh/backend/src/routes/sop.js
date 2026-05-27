const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/sopController');
const auth = require('../middleware/auth');
const { requireLevel } = require('../middleware/roleGuard');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.use(auth);

router.get('/documents', ctrl.listDocuments);
router.post('/documents', requireLevel(3), upload.single('file'), ctrl.uploadDocument);
router.get('/documents/my-progress', ctrl.myProgress);
router.get('/documents/:id', ctrl.getDocument);
router.post('/documents/:id/progress', ctrl.markProgress);
router.post('/documents/:id/quizzes', requireLevel(3), ctrl.createQuiz);
router.get('/quizzes/:quizId', ctrl.getQuiz);
router.post('/quizzes/:quizId/submit', ctrl.submitQuiz);

module.exports = router;
