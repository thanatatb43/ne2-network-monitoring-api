const { BudgetTransaction } = require('../models');
const xlsx = require('xlsx');
const fs = require('fs');

/**
 * Helper to parse dates from "DD.MM.YYYY" to standard JS Date/String
 */
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  // If excel read it as a number (serial date)
  if (typeof dateStr === 'number') {
    // Excel epoch starts at 1900-01-01, but has a leap year bug in 1900.
    // xlsx library usually handles this if cell type is date, but if it's raw number:
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + dateStr * 86400000);
    return dt.toISOString().split('T')[0];
  }

  if (typeof dateStr === 'string') {
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      // Assuming DD.MM.YYYY
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }
  return null;
};

/**
 * Upload and parse Excel file
 */
const uploadTransactions = async (req, res, next) => {
  try {
    const { cost_center, year } = req.body;

    if (!cost_center || !year) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Please provide both cost_center and year in the request body.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please upload an Excel file.'
      });
    }

    const filePath = req.file.path;

    // Read the Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert sheet to JSON
    const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: null });

    if (rawData.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'The uploaded Excel file is empty.'
      });
    }

    // Required headers with possible aliases
    const headerMapping = {
      'สปก.ต้นทุน': ['สปก.ต้นทุน'],
      'ชื่อสปก.ต้นทุน': ['ชื่อสปก.ต้นทุน'],
      'บ/ชหักล้าง': ['บ/ชหักล้าง'],
      'ชื่อของบัญชีหักล้าง': ['ชื่อของบัญชีหักล้าง'],
      'ชื่อผู้ใช้': ['ชื่อผู้ใช้', 'ผู้ใช้'],
      'ว/ทเอกสาร': ['ว/ทเอกสาร'],
      'Postg Date': ['Postg Date'],
      'RefDocNo': ['RefDocNo'],
      'Value COCurr': ['Value COCurr', 'ValueCOCur'],
      'ชื่อ': ['ชื่อ']
    };

    // Check if first row has all required headers (ignoring spaces, allowing aliases)
    const fileHeaders = Object.keys(rawData[0]).map(h => h.trim());
    const missingHeaders = Object.keys(headerMapping).filter(requiredKey => {
      // Check if any of the aliases for this required key exist in the file
      return !headerMapping[requiredKey].some(alias => fileHeaders.includes(alias));
    });

    if (missingHeaders.length > 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Invalid Excel format. Missing required columns: ${missingHeaders.join(', ')}. กรุณาตรวจสอบหัว Column ไฟล์ที่อัพโหลด.`,
        missing_columns: missingHeaders
      });
    }

    const transactionsToInsert = [];

    for (const row of rawData) {
      // Helper to access row value by trimmed key and aliases
      const getVal = (keyName) => {
        const aliases = headerMapping[keyName] || [keyName];
        const actualKey = Object.keys(row).find(k => aliases.includes(k.trim()));
        return actualKey ? row[actualKey] : null;
      };

      const transaction = {
        cost_center: cost_center, // Use provided cost center from body
        cost_center_name: getVal('ชื่อสปก.ต้นทุน') || null,
        clearing_account: getVal('บ/ชหักล้าง') ? String(getVal('บ/ชหักล้าง')) : null,
        clearing_account_name: getVal('ชื่อของบัญชีหักล้าง') || null,
        username: getVal('ชื่อผู้ใช้') || null,
        document_date: parseDate(getVal('ว/ทเอกสาร')),
        posting_date: parseDate(getVal('Postg Date')),
        reference_doc_no: getVal('RefDocNo') ? String(getVal('RefDocNo')) : null,
        value_co_curr: getVal('Value COCurr') ? parseFloat(String(getVal('Value COCurr')).replace(/,/g, '')) : null,
        description: getVal('ชื่อ') || null,
        year: parseInt(year) // Add the year from body
      };

      // Only insert rows that have a value
      if (transaction.value_co_curr !== null || getVal('สปก.ต้นทุน')) {
        transactionsToInsert.push(transaction);
      }
    }

    if (transactionsToInsert.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'The uploaded Excel file is empty or does not contain valid transaction data.'
      });
    }

    // Fetch existing records for comparison
    const existingRecords = await BudgetTransaction.findAll({
      where: { cost_center: cost_center, year: year },
      raw: true
    });

    // Determine new vs updated
    let updatedCount = 0;
    let newCount = 0;
    const updatedRows = [];

    transactionsToInsert.forEach(newTx => {
      // Find if this transaction existed before based on RefDocNo and description
      const existed = existingRecords.find(oldTx =>
        oldTx.reference_doc_no === newTx.reference_doc_no &&
        oldTx.description === newTx.description
      );

      if (existed) {
        updatedCount++;
        // If the value changed, we can track it
        if (existed.value_co_curr !== newTx.value_co_curr) {
          updatedRows.push({
            reference_doc_no: newTx.reference_doc_no,
            description: newTx.description,
            old_value: existed.value_co_curr,
            new_value: newTx.value_co_curr
          });
        }
      } else {
        newCount++;
      }
    });

    // Destroy existing records for this cost_center and year
    const destroyedCount = await BudgetTransaction.destroy({
      where: { cost_center: cost_center, year: year },
      force: true // Hard delete to prevent bloating the soft-deleted records on repeated uploads
    });

    // Bulk create in database
    await BudgetTransaction.bulkCreate(transactionsToInsert);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: `Upload complete. Total rows: ${transactionsToInsert.length} (New: ${newCount}, Updated/Maintained: ${updatedCount}). Destroyed ${destroyedCount} old rows.`,
      total_rows: transactionsToInsert.length,
      new_rows: newCount,
      updated_rows_count: updatedCount,
      changed_values: updatedRows, // Shows specifically which rows had a change in their monetary value
      data: transactionsToInsert
    });
  } catch (error) {
    // Attempt to clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

/**
 * Get unique values for transaction selectors
 */
const getTransactionSelectors = async (req, res, next) => {
  try {
    const fields = [
      'cost_center',
      'cost_center_name',
      'clearing_account',
      'clearing_account_name',
      'username',
      'reference_doc_no',
      'description',
      'year'
    ];

    const selectors = {};

    for (const field of fields) {
      const values = await BudgetTransaction.findAll({
        attributes: [[BudgetTransaction.sequelize.fn('DISTINCT', BudgetTransaction.sequelize.col(field)), field]],
        where: { [field]: { [require('sequelize').Op.ne]: null } },
        raw: true
      });
      selectors[field] = values.map(v => v[field]).sort();
    }

    res.status(200).json({
      success: true,
      data: selectors
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all transactions
 */
const getAllTransactions = async (req, res, next) => {
  try {
    const transactions = await BudgetTransaction.findAll({
      order: [['posting_date', 'DESC'], ['createdAt', 'DESC']]
    });
    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Find transactions by filters
 */
const findTransactions = async (req, res, next) => {
  try {
    const filters = {};
    const allowedFilters = [
      'cost_center',
      'cost_center_name',
      'clearing_account',
      'clearing_account_name',
      'username',
      'reference_doc_no',
      'description',
      'year'
    ];

    // Build where clause from request body (JSON)
    allowedFilters.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== '') {
        // Support array of values or single value string
        let values = Array.isArray(req.body[field]) ? req.body[field] : String(req.body[field]).split(',');

        // Remove empty strings if any
        values = values.filter(v => v !== '');

        if (values.length > 0) {
          if (['username', 'description', 'clearing_account', 'clearing_account_name'].includes(field)) {
            const Op = require('sequelize').Op;
            // Use LIKE for partial matching on these specific fields
            filters[field] = {
              [Op.or]: values.map(v => ({ [Op.like]: `%${v}%` }))
            };
          } else {
            // Strict matching for other fields like year, cost_center, etc.
            filters[field] = {
              [require('sequelize').Op.in]: values
            };
          }
        }
      }
    });

    const transactions = await BudgetTransaction.findAll({
      where: filters,
      order: [['posting_date', 'DESC'], ['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadTransactions,
  getAllTransactions,
  getTransactionSelectors,
  findTransactions
};
