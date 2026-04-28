const express = require('express');
const router = express.Router();

// Import individual route files here
// const userRoutes = require('./userRoutes');

const networkDeviceRoutes = require('./networkDeviceRoutes');
const latencyRoutes = require('./latencyRoutes');
const clientRoutes = require('./clientRoutes');
const authRoutes = require('./authRoutes');
const diagnosticRoutes = require('./diagnosticRoutes');
const statsRoutes = require('./statsRoutes');
const webhookRoutes = require('./webhookRoutes');
const budgetRoutes = require('./budgetRoutes');

router.use('/devices', networkDeviceRoutes);
router.use('/latency', latencyRoutes);
router.use('/clients', clientRoutes);
router.use('/auth', authRoutes);
router.use('/test', diagnosticRoutes);
router.use('/stats', statsRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/budgets', budgetRoutes);

module.exports = router;
