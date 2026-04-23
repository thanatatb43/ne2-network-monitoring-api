const express = require('express');
const router = express.Router();
const diagnosticController = require('../controllers/diagnosticController');

const { verifyToken, optionalVerifyToken, hasRole } = require('../middleware/authMiddleware');

// GET /api/test/ping - Latency test
router.get('/ping', diagnosticController.ping);

// GET /api/test/download - Download speed test
router.get('/download', diagnosticController.downloadTest);

// POST /api/test/upload - Upload speed test
router.post('/upload', diagnosticController.uploadTest);

// POST /api/test/report - Log speed test results (Optional Token)
router.post('/report', optionalVerifyToken, diagnosticController.reportResults);

// GET /api/test/history - View speed test logs (Admin/Manager/NetworkAdmin)
router.get('/history', verifyToken, hasRole(['super_admin', 'manager', 'network_admin']), diagnosticController.getHistory);

// GET /api/test/my-ip - Get client IP
router.get('/my-ip', diagnosticController.getMyIp);

module.exports = router;
