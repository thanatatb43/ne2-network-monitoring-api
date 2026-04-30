const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');
const budgetTransactionController = require('../controllers/budgetTransactionController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Public routes (No token required)
router.get('/summary/:year', budgetController.getBudgetSummary);
router.get('/selectors', budgetController.getBudgetSelectors);
router.get('/transactions/selectors', budgetTransactionController.getTransactionSelectors);
router.post('/transactions/find', budgetTransactionController.findTransactions);
router.get('/transactions/username-groups', budgetTransactionController.getUsernameGroups);

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
router.get('/transactions', budgetTransactionController.getAllTransactions);


// Parameterized routes
router.get('/:id', budgetController.getBudgetById);

// Write routes: restricted to super_admin, computer_admin, network_admin, and operator
router.post('/', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), budgetController.createBudget);
router.put('/:id', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), budgetController.updateBudget);
router.delete('/:id', hasRole(['super_admin']), budgetController.deleteBudget);

module.exports = router;
