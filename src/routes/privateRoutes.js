const express = require('express');
const router = express.Router();
const ipAllowlist = require('../middleware/ipAllowlistMiddleware');
const peaJobController = require('../controllers/peaJobController');
const officeEquipmentController = require('../controllers/officeEquipmentController');

// Every route under /api/private/* is gated by source IP instead of a JWT -
// meant for another internal webserver sharing this database, not end users.
router.use(ipAllowlist);

// CRUD: PeaJobs
router.get('/pea-jobs', peaJobController.getAllJobs);
router.get('/pea-jobs/:id', peaJobController.getJobById);
router.post('/pea-jobs', peaJobController.createJob);
router.put('/pea-jobs/:id', peaJobController.updateJob);
router.delete('/pea-jobs/:id', peaJobController.deleteJob);

// CRUD: OfficeEquipment
router.get('/office-equipment', officeEquipmentController.getAllEquipment);
// Must come before /office-equipment/:id so "loans" isn't swallowed as an :id.
router.get('/office-equipment/loans', officeEquipmentController.getAllLoans);
router.get('/office-equipment/:id', officeEquipmentController.getEquipmentById);
router.post('/office-equipment', officeEquipmentController.createEquipment);
router.put('/office-equipment/:id', officeEquipmentController.updateEquipment);
router.delete('/office-equipment/:id', officeEquipmentController.deleteEquipment);

// Borrow/return: OfficeEquipment
router.get('/office-equipment/:id/loans', officeEquipmentController.getEquipmentLoanHistory);
router.post('/office-equipment/:id/borrow', officeEquipmentController.borrowEquipment);
router.post('/office-equipment/borrow-batch', officeEquipmentController.borrowEquipmentBatch);
router.post('/office-equipment/:id/return', officeEquipmentController.returnEquipment);

module.exports = router;
