const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Microsoft Teams Outgoing Webhook endpoint
router.post('/teams', webhookController.handleTeamsOutgoingWebhook);

module.exports = router;
