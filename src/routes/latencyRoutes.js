const express = require('express');
const router = express.Router();
const latencyController = require('../controllers/latencyController');

router.get('/average', latencyController.getAverageLatency);
router.get('/recent', latencyController.getRecentLatency);
router.get('/summary', latencyController.getRecentLatencySummary);
router.get('/metrics', latencyController.getDeviceMetrics);

module.exports = router;
