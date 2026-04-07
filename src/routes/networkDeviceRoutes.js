const express = require('express');
const router = express.Router();
const networkDeviceController = require('../controllers/networkDeviceController');

router.get('/', networkDeviceController.getAllDevices);
router.get('/:id', networkDeviceController.getDeviceById);

module.exports = router;
