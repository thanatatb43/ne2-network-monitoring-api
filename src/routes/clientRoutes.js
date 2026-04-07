const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

// Scan a network device's subnet and sync clients
router.post('/scan/:index', clientController.scanNetworkAndSync);

// Get all clients associated with a specific network device ID
router.get('/device/:id', clientController.getClientsByDevice);

module.exports = router;
