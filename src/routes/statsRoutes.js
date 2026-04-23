const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');

// POST /api/stats/track
router.post('/track', statsController.trackEvent);

// GET /api/stats/summary
router.get('/summary', statsController.getSummary);

module.exports = router;
