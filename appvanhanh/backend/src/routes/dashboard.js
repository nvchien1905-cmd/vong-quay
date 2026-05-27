const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

router.use(auth);

router.get('/', ctrl.adminSummary);
router.get('/overview', ctrl.overview);
router.get('/incomplete-employees', ctrl.incompleteEmployees);
router.get('/users', ctrl.listUsers);
router.get('/stores', ctrl.listStores);

module.exports = router;
