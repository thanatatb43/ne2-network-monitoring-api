const express = require('express');
const router = express.Router();
const officeEquipmentController = require('../controllers/officeEquipmentController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// Public read routes
router.get('/', officeEquipmentController.getAllEquipment);
router.get('/site/:pea_site_id', officeEquipmentController.getEquipmentBySite);
router.get('/:id', officeEquipmentController.getEquipmentById);

// Write routes: require authentication
router.use(verifyToken);

router.post('/', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), officeEquipmentController.createEquipment);
router.put('/:id', hasRole(['super_admin', 'computer_admin', 'network_admin', 'operator']), officeEquipmentController.updateEquipment);
router.delete('/:id', hasRole(['super_admin', 'computer_admin', 'network_admin']), officeEquipmentController.deleteEquipment);

module.exports = router;
