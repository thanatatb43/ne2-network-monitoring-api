const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const peaJobController = require('../controllers/peaJobController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Base route is /api/pea-jobs

// Ensure uploads/pea-jobs directory exists
const uploadDir = path.join(__dirname, '../../uploads/pea-jobs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

const imageFileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed.'));
};

const uploadPhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: imageFileFilter
});

// Notification doc can be an image or a PDF
const docFileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF are allowed.'));
};

const uploadDoc = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: docFileFilter
});

// Public routes (no token required)
router.get('/', peaJobController.getAllJobs);
router.get('/sites', peaJobController.getPeaSitesLookup);
router.get('/site/:pea_site_id/transactions', peaJobController.getTransactionsBySite);
router.get('/:id/history', peaJobController.getJobHistory);
router.get('/:id', peaJobController.getJobById);

// Protected routes (require token and specific roles)
const allowedRoles = ['super_admin', 'network_admin', 'computer_admin', 'operator'];
const deleteRoles = ['super_admin', 'network_admin', 'computer_admin']; // narrower than allowedRoles - no operator

// เปิดงาน: any authenticated user (any role) can file a ticket, not just IT staff
router.post('/', verifyToken, peaJobController.createJob);
router.post('/transactions', verifyToken, hasRole(allowedRoles), peaJobController.addTransactionsToSite);
router.put('/:id', verifyToken, hasRole(allowedRoles), peaJobController.updateJob);
router.delete('/:id', verifyToken, hasRole(deleteRoles), peaJobController.deleteJob);

router.post('/:id/equipment', verifyToken, hasRole(allowedRoles), peaJobController.addEquipmentToJob);
router.delete('/:id/equipment/:equipment_id', verifyToken, hasRole(allowedRoles), peaJobController.removeEquipmentFromJob);

// Part of เปิดงาน - any authenticated user can attach the equipment they're reporting,
// same as being able to open the ticket itself. Removing an already-reported item is
// more of an admin correction, so that stays role-restricted.
router.post('/:id/problem-equipment', verifyToken, peaJobController.addProblemEquipmentToJob);
router.delete('/:id/problem-equipment/:equipment_id', verifyToken, hasRole(allowedRoles), peaJobController.removeProblemEquipmentFromJob);

// Workflow stage transitions
router.put('/:id/progress', verifyToken, hasRole(allowedRoles), peaJobController.updateJobProgress);
router.put('/:id/complete', verifyToken, hasRole(allowedRoles), uploadDoc.single('completion_report'), peaJobController.completeJob);
router.put('/:id/cancel', verifyToken, hasRole(allowedRoles), peaJobController.cancelJob);

// File uploads
// Part of เปิดงาน - any authenticated user can attach their own notification doc
router.post('/:id/notification-doc', verifyToken, uploadDoc.single('notification_doc'), peaJobController.uploadNotificationDoc);
router.post('/:id/after-photos', verifyToken, hasRole(allowedRoles), uploadPhoto.array('photos', 5), peaJobController.uploadJobAfterPhotos);

module.exports = router;
