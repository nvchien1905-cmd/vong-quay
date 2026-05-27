const router = require('express').Router();
const ctrl = require('../controllers/kpiController');
const auth = require('../middleware/auth');

router.use(auth);

router.get('/me', ctrl.myKpi);
router.get('/employees', ctrl.employeeRanking);
router.get('/stores', ctrl.storeRanking);

module.exports = router;
