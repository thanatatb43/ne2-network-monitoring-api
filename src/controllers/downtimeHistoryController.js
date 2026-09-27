'use strict';
const { createService } = require('../services/downtimeHistoryService');
const { ContractError } = require('../services/downtimeContract');
const service = createService(require('../models'));
const handler = endpoint => async (req, res) => {
  try {
    res.status(200).json(await service.execute(endpoint, req.query));
  } catch (error) {
    if (error instanceof ContractError) {
      return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message, fields: error.fields } });
    }
    console.error(`[Downtime v2] ${endpoint} failed`, error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to read downtime history', fields: [] } });
  }
};
module.exports = { incidents: handler('incidents'), summary: handler('summary'), dashboard: handler('dashboard'), selectors: handler('selectors') };
