const express = require('express');
const router = express.Router();
const latencyController = require('../controllers/latencyController');

router.get('/average', latencyController.getAverageLatency);
router.get('/recent', latencyController.getRecentLatency);
router.get('/summary', latencyController.getRecentLatencySummary);
router.get('/metrics', latencyController.getDeviceMetrics);
router.get('/status-summary', latencyController.getStatusSummary);
router.get('/down', latencyController.getDownDevices);
// POST is the canonical method - the check writes DeviceMetrics and can send a Teams
// alert. GET is kept only until existing callers move over; it answers with a
// Deprecation header.
router.post('/check/:id', latencyController.checkDeviceStatus);
router.get('/check/:id', latencyController.checkDeviceStatus);
router.get('/availability/:id', latencyController.getDeviceAvailability);
router.get('/availability-snapshots', latencyController.getAvailabilitySnapshots);
router.get('/availability-snapshots/:id', latencyController.getDeviceAvailabilitySnapshots);


module.exports = router;
