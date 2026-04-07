const express = require('express');
const router = express.Router();

// Import individual route files here
// const userRoutes = require('./userRoutes');

const networkDeviceRoutes = require('./networkDeviceRoutes');
const latencyRoutes = require('./latencyRoutes');
const clientRoutes = require('./clientRoutes');

// router.use('/users', userRoutes);
router.use('/devices', networkDeviceRoutes);
router.use('/latency', latencyRoutes);
router.use('/clients', clientRoutes);

module.exports = router;

module.exports = router;
