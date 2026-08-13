const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const officeEquipmentController = require('../controllers/officeEquipmentController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Ensure uploads/office-equipment directory exists
const uploadDir = path.join(__dirname, '../../uploads/office-equipment');
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

// Public read routes
router.get('/', officeEquipmentController.getAllEquipment);
router.get('/site/:pea_site_id', officeEquipmentController.getEquipmentBySite);
router.get('/:id/qrcode', officeEquipmentController.getEquipmentQrCode);
router.get('/:id/loans', officeEquipmentController.getEquipmentLoanHistory);
router.get('/:id/history', officeEquipmentController.getEquipmentHistory);
router.get('/:id', officeEquipmentController.getEquipmentById);

// Write routes: require authentication
router.use(verifyToken);

router.post('/', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), officeEquipmentController.createEquipment);
router.put('/:id', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), officeEquipmentController.updateEquipment);
router.delete('/:id', hasRole(['super_admin', 'computer_admin', 'network_admin']), officeEquipmentController.deleteEquipment);

// Borrow/return: any authenticated user (scan action, not admin-restricted)
router.post('/:id/borrow', officeEquipmentController.borrowEquipment);
router.post('/:id/return', officeEquipmentController.returnEquipment);

// Photo uploads (max 5 total, 5MB each) and the single storage-location photo (5MB)
router.post('/:id/photos', uploadPhoto.array('photos', 5), officeEquipmentController.uploadEquipmentPhotos);
router.delete('/:id/photos', officeEquipmentController.deleteEquipmentPhoto);
router.post('/:id/storage-photo', uploadPhoto.single('storage_photo'), officeEquipmentController.uploadStorageLocationPhoto);

module.exports = router;
