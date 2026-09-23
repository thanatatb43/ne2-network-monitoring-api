const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');
const budgetTransactionController = require('../controllers/budgetTransactionController');
const budgetDashboardController = require('../controllers/budgetDashboardController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Public routes (No token required) - every read endpoint in this app is public by
// default (see officeEquipmentRoutes, the legacy budget endpoints below); the new
// dashboard endpoints follow the same convention. See budgetDashboardController.js
// header, deviation 5, for the reasoning.
router.get('/summary/:year', budgetController.getBudgetSummary); // legacy - kept for compatibility, see BUDGET_DASHBOARD_BACKEND_API_SPEC.md section 9
router.get('/selectors', budgetController.getBudgetSelectors);
router.get('/dashboard/summary', budgetDashboardController.getDashboardSummary);

// /transactions/selectors: new field/q/limit mode when ?field= is present, otherwise
// falls through to the legacy full-list response - see getTransactionSelectors below.
router.get('/transactions/selectors', budgetTransactionController.getTransactionSelectors);

// Must come before /transactions/:transaction_id so these literal segments aren't
// swallowed as an id.
router.get('/transactions/aggregates', budgetDashboardController.getTransactionsAggregates);
router.post('/transactions/find', budgetTransactionController.findTransactions); // legacy - kept for compatibility
router.get('/transactions/username-groups', budgetTransactionController.getUsernameGroups);

router.get('/transactions', budgetDashboardController.getTransactionsList);
router.get('/transactions/:transaction_id', budgetDashboardController.getTransactionById);

// Apply verifyToken to other budget routes
router.use(verifyToken);

// GET routes: accessible by anyone authenticated
router.get('/', budgetController.getAllBudgets);

const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB limit
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.csv' || ext === '.xls') {
            return cb(null, true);
        }
        // Reject file
        cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV (.csv) files are allowed.'));
    }
});

// Transaction routes (Must be before /:id)
router.post('/upload-transactions', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), upload.single('file'), budgetTransactionController.uploadTransactions);


// Parameterized routes
router.get('/:id', budgetController.getBudgetById);

// Write routes: restricted to super_admin, computer_admin, network_admin, and operator
router.post('/', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), budgetController.createBudget);
router.put('/:id', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), budgetController.updateBudget);
router.delete('/:id', hasRole(['super_admin']), budgetController.deleteBudget);

module.exports = router;
