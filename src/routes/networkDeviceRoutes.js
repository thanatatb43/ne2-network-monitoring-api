const express = require('express');
const router = express.Router();
const networkDeviceController = require('../controllers/networkDeviceController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

router.get('/', networkDeviceController.getAllDevices);
router.get('/:id', networkDeviceController.getDeviceById);

// Create network device - restricted to super_admin and network_admin
router.post('/', verifyToken, hasRole(['super_admin', 'network_admin']), networkDeviceController.createDevice);

// Update network device - restricted to super_admin and network_admin
router.put('/:id', verifyToken, hasRole(['super_admin', 'network_admin']), networkDeviceController.updateDevice);

// Delete network device - restricted to super_admin and network_admin
router.delete('/:id', verifyToken, hasRole(['super_admin']), networkDeviceController.deleteDevice);

module.exports = router;
