const express = require('express');
const router = express.Router();
const peaJobController = require('../controllers/peaJobController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Base route is /api/pea-jobs

// Public routes (no token required)
router.get('/', peaJobController.getAllJobs);
router.get('/sites', peaJobController.getPeaSitesLookup);
router.get('/:id', peaJobController.getJobById);
router.get('/site/:pea_site_id', peaJobController.getJobsBySite);
router.get('/site/:pea_site_id/transactions', peaJobController.getTransactionsBySite);

// Protected routes (require token and specific roles)
const allowedRoles = ['super_admin', 'network_admin', 'computer_admin', 'operator'];

router.post('/', verifyToken, hasRole(allowedRoles), peaJobController.createJob);
router.post('/transactions', verifyToken, hasRole(allowedRoles), peaJobController.addTransactionsToSite);
router.put('/:id', verifyToken, hasRole(allowedRoles), peaJobController.updateJob);
router.delete('/:id', verifyToken, hasRole(allowedRoles), peaJobController.deleteJob);

module.exports = router;
