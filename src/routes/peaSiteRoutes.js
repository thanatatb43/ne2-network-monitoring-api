const express = require('express');
const router = express.Router();
const peaSiteController = require('../controllers/peaSiteController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Read: open to everyone (no login required), matching the existing convention for lookup-style endpoints
router.get('/', peaSiteController.getAllSites);
router.get('/summary', peaSiteController.getSitesWithCounts);
router.get('/:id', peaSiteController.getSiteById);

// Write: super_admin only
router.use(verifyToken, hasRole(['super_admin']));

router.post('/', peaSiteController.createSite);
router.put('/:id', peaSiteController.updateSite);
router.delete('/:id', peaSiteController.deleteSite);

module.exports = router;
