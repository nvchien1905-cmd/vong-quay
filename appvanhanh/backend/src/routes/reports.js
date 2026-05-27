const router = require('express').Router();
const ctrl = require('../controllers/reportController');
const auth = require('../middleware/auth');
const { requireLevel } = require('../middleware/roleGuard');

router.use(auth);
router.use(requireLevel(2));

router.get('/', ctrl.yearlyReport);
router.get('/tasks', ctrl.taskStats);
router.get('/kpi', ctrl.kpiReport);

module.exports = router;
