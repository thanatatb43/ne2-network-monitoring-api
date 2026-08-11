const net = require('net');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { OfficeEquipment, OfficeEquipmentAuditLog, OfficeEquipmentLoan, PeaSite, User, NetworkDevices } = require('../models');

const MAX_PHOTOS = 5;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Windows can transiently lock a file right after it's written/read (antivirus
 * scanning it, or the OS not having released the handle yet) even though the async
 * I/O call that produced it already resolved. Retry the given sync fs operation a
 * few times with backoff before giving up, instead of failing the whole request.
 */
const retryFsOp = async (fn, attempts = 5, delayMs = 150) => {
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      const transient = ['EBUSY', 'EPERM', 'EACCES'].includes(err.code);
      if (!transient || i === attempts - 1) throw err;
      await sleep(delayMs * (i + 1));
    }
  }
};

/** Delete an uploaded file given its public path (e.g. "/uploads/office-equipment/xxx.jpg") */
const deleteUploadedFile = async (publicPath) => {
  if (!publicPath) return;
  const filePath = path.join(__dirname, '../../', publicPath);
  if (fs.existsSync(filePath)) {
    try {
      await retryFsOp(() => fs.unlinkSync(filePath));
    } catch (err) {
      console.error(`[deleteUploadedFile] Could not remove file ${filePath}:`, err.message);
    }
  }
};

/**
 * Re-compress an uploaded image in place: cap it at 1600px on the longest side and
 * re-encode as JPEG at quality 70. Typically cuts phone-camera photos (which are
 * often much larger than needed for on-screen viewing) by 60%+ with no visible
 * quality loss at normal viewing sizes. Always converts to .jpg, overwriting
 * whatever extension the original upload had, and returns the new absolute path.
 */
const compressImage = async (originalPath) => {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath, path.extname(originalPath));
  // Write straight to a fresh, unique final filename - no intermediate .tmp file and
  // no rename step. Windows can transiently lock a file right after it's created
  // (antivirus scanning it) for longer than a bounded retry window can reliably
  // cover, so the safest fix is to avoid needing a rename at all.
  const finalPath = path.join(dir, `${base}-c${Date.now()}.jpg`);

  await sharp(originalPath)
    .rotate() // apply EXIF orientation before stripping it
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toFile(finalPath);

  // Clean up the original upload; non-fatal if Windows is still holding a lock on
  // it - the compressed file is already safely in place either way.
  try {
    await retryFsOp(() => fs.unlinkSync(originalPath), 8, 200);
  } catch (err) {
    console.error(`[compressImage] Could not remove original file ${originalPath}:`, err.message);
  }

  return finalPath;
};

const MAC_REGEX = /^([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})$/;

const includeRelations = [
  {
    model: PeaSite,
    as: 'pea_site',
    attributes: ['id', 'pea_name', 'pea_province'],
    include: [
      { model: NetworkDevices, as: 'network_device', attributes: ['gateway', 'sub_ip1_gateway', 'sub_ip2_gateway', 'dhcp'] }
    ]
  },
  { model: User, as: 'created_by', attributes: ['id', 'username', 'first_name', 'last_name'] }
];

// Some IP fields use "-" as a placeholder for "not set" instead of null/empty string
const isEmptyIp = (value) => !value || value === '-';

/**
 * Build the network_ip block from a NetworkDevices row (or null). When
 * secondary_172 (sub_ip1_gateway) is missing, fall back to showing the dhcp range instead.
 */
const buildNetworkIp = (nd) => {
  const secondary172 = nd ? nd.sub_ip1_gateway : null;

  return {
    main: nd ? nd.gateway : null,
    secondary_172: secondary172,
    secondary_10: nd ? nd.sub_ip2_gateway : null,
    dhcp_range: isEmptyIp(secondary172) ? (nd ? nd.dhcp : null) : null
  };
};

/**
 * Flatten the network_device IPs (via pea_site) into a simple network_ip block,
 * and drop the raw nested network_device object from the response.
 */
const attachNetworkIp = (equipmentInstance) => {
  const json = equipmentInstance.toJSON ? equipmentInstance.toJSON() : equipmentInstance;
  const nd = json.pea_site ? json.pea_site.network_device : null;

  json.network_ip = buildNetworkIp(nd);

  if (json.pea_site) delete json.pea_site.network_device;
  return json;
};

/**
 * Look up the network_ip block for a PEA site directly (independent of whether
 * that site has any office equipment rows at all).
 */
const getSiteNetworkIp = async (pea_site_id) => {
  const nd = await NetworkDevices.findOne({
    where: { pea_site_id },
    attributes: ['gateway', 'sub_ip1_gateway', 'sub_ip2_gateway', 'dhcp']
  });

  return buildNetworkIp(nd);
};

/**
 * Helper to log office equipment actions for auditing
 */
const logAudit = async (req, action, equipment, data) => {
  try {
    await OfficeEquipmentAuditLog.create({
      equipment_id: equipment ? equipment.id : null,
      action,
      equipment_name: equipment ? equipment.name : (data ? data.name : null),
      data: data || (equipment ? equipment.toJSON() : null),
      user_id: req.user ? req.user.id : null,
      user_name: req.user ? req.user.name || req.user.username : 'Unknown'
    });
  } catch (error) {
    console.error('Audit logging failed:', error);
  }
};

/**
 * Check for duplicate ip_address / mac_address across office equipment
 * @param {Object} data - Data to check (ip_address, mac_address)
 * @param {number|null} excludeId - ID to exclude (for updates)
 * @returns {Promise<string|null>} - Returns the name of the field that is duplicate, or null
 */
const checkDuplicates = async (data, excludeId = null) => {
  const { Op } = require('sequelize');
  const uniqueFields = ['ip_address', 'mac_address'];

  for (const field of uniqueFields) {
    const value = data[field];
    if (value) {
      const where = { [field]: value };
      if (excludeId) {
        where.id = { [Op.ne]: excludeId };
      }

      const existing = await OfficeEquipment.findOne({ where });
      if (existing) {
        return field;
      }
    }
  }
  return null;
};

/**
 * Get all office equipment (optionally filtered by department, pea_site_id, status)
 */
const getAllEquipment = async (req, res, next) => {
  try {
    const { department, pea_site_id, status } = req.query;
    const where = {};
    if (department) where.department = department;
    if (pea_site_id) where.pea_site_id = pea_site_id;
    if (status) where.status = status;

    const equipment = await OfficeEquipment.findAll({
      where,
      include: includeRelations,
      order: [['name', 'ASC']]
    });

    res.status(200).json({
      success: true,
      count: equipment.length,
      data: equipment.map(attachNetworkIp)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all office equipment belonging to a specific PEA site
 */
const getEquipmentBySite = async (req, res, next) => {
  try {
    const { pea_site_id } = req.params;

    const equipment = await OfficeEquipment.findAll({
      where: { pea_site_id },
      include: includeRelations,
      // updatedAt equals createdAt until first edit, so sorting by it alone
      // covers "most recently created or edited" in one column.
      order: [['updatedAt', 'DESC']]
    });

    const network_ip = await getSiteNetworkIp(pea_site_id);

    res.status(200).json({
      success: true,
      count: equipment.length,
      network_ip,
      data: equipment.map(attachNetworkIp)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single office equipment by ID
 */
const getEquipmentById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const equipment = await OfficeEquipment.findByPk(id, { include: includeRelations });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Office equipment not found',
        network_ip: { main: null, secondary_172: null, secondary_10: null }
      });
    }

    res.status(200).json({
      success: true,
      data: attachNetworkIp(equipment)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new office equipment
 */
const createEquipment = async (req, res, next) => {
  try {
    const { name, ip_address, mac_address, ...otherData } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: name is required'
      });
    }

    if (ip_address && !net.isIPv4(ip_address)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IPv4 address for field: ip_address'
      });
    }

    if (mac_address && !MAC_REGEX.test(mac_address)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid MAC address for field: mac_address'
      });
    }

    const duplicateField = await checkDuplicates({ ip_address, mac_address });
    if (duplicateField) {
      return res.status(400).json({
        success: false,
        message: `Office equipment with this ${duplicateField} already exists`
      });
    }

    const equipmentData = {
      name,
      ip_address: ip_address || null,
      mac_address: mac_address || null,
      ...otherData,
      created_by_user_id: req.user ? req.user.id : null
    };

    const newEquipment = await OfficeEquipment.create(equipmentData);

    await logAudit(req, 'CREATE', newEquipment);

    res.status(201).json({
      success: true,
      message: 'Office equipment created successfully',
      data: newEquipment
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update office equipment by ID
 */
const updateEquipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const equipment = await OfficeEquipment.findByPk(id);

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Office equipment not found'
      });
    }

    const { id: _, createdAt, updatedAt, created_by_user_id, ...body } = req.body;
    const updateData = {};

    for (const [key, value] of Object.entries(body)) {
      if (value === '' || value === null) {
        continue;
      }
      if (equipment[key] === value) {
        continue;
      }

      if (key === 'ip_address' && !net.isIPv4(value)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid IPv4 address for field: ip_address'
        });
      }
      if (key === 'mac_address' && !MAC_REGEX.test(value)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid MAC address for field: mac_address'
        });
      }

      updateData[key] = value;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected. Everything is already up to date.'
      });
    }

    if (updateData.ip_address || updateData.mac_address) {
      const duplicateField = await checkDuplicates(
        { ip_address: updateData.ip_address, mac_address: updateData.mac_address },
        id
      );
      if (duplicateField) {
        return res.status(400).json({
          success: false,
          message: `Office equipment with this ${duplicateField} already exists`
        });
      }
    }

    await equipment.update(updateData);

    await logAudit(req, 'UPDATE', equipment, updateData);

    res.status(200).json({
      success: true,
      message: 'Office equipment updated successfully',
      data: equipment
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete (soft delete) office equipment by ID
 */
const deleteEquipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const equipment = await OfficeEquipment.findByPk(id);

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Office equipment not found'
      });
    }

    await logAudit(req, 'DELETE', equipment);

    await equipment.destroy();

    res.status(200).json({
      success: true,
      message: 'Office equipment deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate a QR code image (PNG) encoding this equipment's id, for printing
 * onto a physical label. Scanning it and hitting /:id gives the full record.
 */
const getEquipmentQrCode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const equipment = await OfficeEquipment.findByPk(id);

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Office equipment not found'
      });
    }

    const qrContent = `${process.env.QR_CODE_URL}${equipment.id}`;

    const buffer = await QRCode.toBuffer(qrContent, {
      type: 'png',
      width: 300,
      margin: 2
    });

    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Mark equipment as borrowed (scan action): creates a loan record and flips status.
 */
const borrowEquipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { due_date, notes } = req.body;

    const equipment = await OfficeEquipment.findByPk(id);
    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Office equipment not found' });
    }

    const existingOpenLoan = await OfficeEquipmentLoan.findOne({
      where: { equipment_id: id, returned_at: null }
    });
    if (existingOpenLoan) {
      return res.status(400).json({
        success: false,
        message: 'Office equipment is already borrowed and has not been returned yet'
      });
    }

    const loan = await OfficeEquipmentLoan.create({
      equipment_id: id,
      borrowed_by_user_id: req.user ? req.user.id : null,
      borrowed_at: new Date(),
      due_date: due_date || null,
      notes: notes || null
    });

    await equipment.update({ status: 'borrowed' });

    await logAudit(req, 'BORROW', equipment, { loan_id: loan.id, due_date: loan.due_date });

    res.status(201).json({
      success: true,
      message: 'Equipment marked as borrowed',
      data: loan
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark equipment as returned (scan action): closes the open loan record and flips status.
 */
const returnEquipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const equipment = await OfficeEquipment.findByPk(id);
    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Office equipment not found' });
    }

    const openLoan = await OfficeEquipmentLoan.findOne({
      where: { equipment_id: id, returned_at: null },
      order: [['borrowed_at', 'DESC']]
    });

    if (!openLoan) {
      return res.status(400).json({
        success: false,
        message: 'Office equipment is not currently marked as borrowed'
      });
    }

    await openLoan.update({
      returned_at: new Date(),
      notes: notes || openLoan.notes
    });

    await equipment.update({ status: 'active' });

    await logAudit(req, 'RETURN', equipment, { loan_id: openLoan.id });

    res.status(200).json({
      success: true,
      message: 'Equipment marked as returned',
      data: openLoan
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get the full borrow/return history for a piece of equipment.
 */
const getEquipmentLoanHistory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const loans = await OfficeEquipmentLoan.findAll({
      where: { equipment_id: id },
      include: [{ model: User, as: 'borrowed_by', attributes: ['id', 'username', 'first_name', 'last_name'] }],
      order: [['borrowed_at', 'DESC']]
    });

    res.status(200).json({
      success: true,
      count: loans.length,
      data: loans
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Upload up to MAX_PHOTOS (5) equipment photos total. Adds to whatever photos
 * already exist rather than replacing them.
 */
const uploadEquipmentPhotos = async (req, res, next) => {
  try {
    const { id } = req.params;
    const files = req.files || [];

    const equipment = await OfficeEquipment.findByPk(id);
    if (!equipment) {
      files.forEach(f => fs.unlinkSync(f.path));
      return res.status(404).json({ success: false, message: 'Office equipment not found' });
    }

    if (files.length === 0) {
      return res.status(400).json({ success: false, message: 'No photos uploaded' });
    }

    const existingPhotos = equipment.photos || [];
    if (existingPhotos.length + files.length > MAX_PHOTOS) {
      files.forEach(f => fs.unlinkSync(f.path));
      return res.status(400).json({
        success: false,
        message: `Cannot add ${files.length} photo(s): equipment already has ${existingPhotos.length}/${MAX_PHOTOS} photos`
      });
    }

    const newPaths = [];
    for (const file of files) {
      const compressedPath = await compressImage(file.path);
      newPaths.push(`/uploads/office-equipment/${path.basename(compressedPath)}`);
    }
    const photos = [...existingPhotos, ...newPaths];

    await equipment.update({ photos });
    await logAudit(req, 'UPDATE', equipment, { photos_added: newPaths });

    res.status(200).json({
      success: true,
      message: 'Photos uploaded successfully',
      data: { photos }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a single photo from an equipment's photo list and delete its file.
 */
const deleteEquipmentPhoto = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { photo_path } = req.body;

    const equipment = await OfficeEquipment.findByPk(id);
    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Office equipment not found' });
    }

    const existingPhotos = equipment.photos || [];
    if (!photo_path || !existingPhotos.includes(photo_path)) {
      return res.status(400).json({ success: false, message: 'photo_path not found on this equipment' });
    }

    const photos = existingPhotos.filter(p => p !== photo_path);
    await equipment.update({ photos });
    await deleteUploadedFile(photo_path);

    await logAudit(req, 'UPDATE', equipment, { photo_removed: photo_path });

    res.status(200).json({
      success: true,
      message: 'Photo deleted successfully',
      data: { photos }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Upload (or replace) the single storage-location photo for this equipment.
 */
const uploadStorageLocationPhoto = async (req, res, next) => {
  try {
    const { id } = req.params;

    const equipment = await OfficeEquipment.findByPk(id);
    if (!equipment) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Office equipment not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No photo uploaded' });
    }

    await deleteUploadedFile(equipment.storage_photo);

    const compressedPath = await compressImage(req.file.path);
    const storage_photo = `/uploads/office-equipment/${path.basename(compressedPath)}`;
    await equipment.update({ storage_photo });
    await logAudit(req, 'UPDATE', equipment, { storage_photo });

    res.status(200).json({
      success: true,
      message: 'Storage location photo uploaded successfully',
      data: { storage_photo }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllEquipment,
  getEquipmentBySite,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getEquipmentQrCode,
  borrowEquipment,
  returnEquipment,
  getEquipmentLoanHistory,
  uploadEquipmentPhotos,
  deleteEquipmentPhoto,
  uploadStorageLocationPhoto
};
