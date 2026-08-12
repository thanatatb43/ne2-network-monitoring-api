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
const peaJobRoutes = require('./peaJobRoutes');
const officeEquipmentRoutes = require('./officeEquipmentRoutes');
const peaSiteRoutes = require('./peaSiteRoutes');

router.use('/devices', networkDeviceRoutes);
router.use('/latency', latencyRoutes);
router.use('/clients', clientRoutes);
router.use('/auth', authRoutes);
router.use('/test', diagnosticRoutes);
router.use('/stats', statsRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/budgets', budgetRoutes);
router.use('/pea-jobs', peaJobRoutes);
router.use('/office-equipment', officeEquipmentRoutes);
router.use('/pea-sites', peaSiteRoutes);

module.exports = router;
