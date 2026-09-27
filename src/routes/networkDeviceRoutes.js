const express = require('express');
const router = express.Router();
const networkDeviceController = require('../controllers/networkDeviceController');
const downtimeHistoryController = require('../controllers/downtimeHistoryController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

router.get('/', networkDeviceController.getAllDevices);
router.get('/downtime/incidents', downtimeHistoryController.incidents);
router.get('/downtime/selectors', downtimeHistoryController.selectors);
router.get('/downtime/summary', (req, res, next) => req.query.contract === undefined
  ? networkDeviceController.getDowntimeSummary(req, res, next)
  : downtimeHistoryController.summary(req, res, next));
router.get('/downtime/devices', networkDeviceController.getDevicesDowntimeSummary);
router.get('/downtime/all', networkDeviceController.getAllDowntimeRecords);
router.get('/downtime/dashboard', (req, res, next) => req.query.contract === undefined
  ? networkDeviceController.getDowntimeDashboard(req, res, next)
  : downtimeHistoryController.dashboard(req, res, next));
router.get('/:id', networkDeviceController.getDeviceById);
router.get('/:id/downtime', networkDeviceController.getDeviceDowntimeHistory);

// Create network device - restricted to super_admin and network_admin
router.post('/', verifyToken, hasRole(['super_admin', 'network_admin']), networkDeviceController.createDevice);

// Update network device - restricted to super_admin and network_admin
router.put('/:id', verifyToken, hasRole(['super_admin', 'network_admin']), networkDeviceController.updateDevice);

// Delete network device - restricted to super_admin and network_admin
router.delete('/:id', verifyToken, hasRole(['super_admin']), networkDeviceController.deleteDevice);

module.exports = router;
