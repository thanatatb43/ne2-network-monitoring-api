const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { OfficeEquipment, OfficeEquipmentAuditLog, OfficeEquipmentLoan, PeaSite, User, NetworkDevices, PeaJob } = require('../models');
const { notifyEquipmentLoanEvent, notifyEquipmentLoanBatchEvent } = require('../services/notificationService');

const MAX_PHOTOS = 5;
const ASSET_TRACKED_FIELDS = ['asset_number', 'asset_owner', 'asset_owner_emp_id'];

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
  { model: User, as: 'created_by', attributes: ['id', 'username', 'first_name', 'last_name'] },
  // Jobs where this equipment was actually used to fix something else
  { model: PeaJob, as: 'jobs', attributes: ['id', 'job_name', 'job_type', 'status', 'closing_notes', 'createdAt', 'updatedAt'], through: { attributes: [] } },
  // "ประวัติการซ่อม" - jobs opened because THIS equipment itself was reported faulty
  { model: PeaJob, as: 'problem_jobs', attributes: ['id', 'job_name', 'job_type', 'status', 'closing_notes', 'createdAt', 'updatedAt'], through: { attributes: [] } },
  {
    model: OfficeEquipmentLoan,
    as: 'current_loan',
    attributes: ['id', 'batch_id', 'borrower_name', 'borrower_emp_id', 'borrower_contact', 'borrowed_at', 'due_date'],
    include: [
      { model: User, as: 'borrowed_by', attributes: ['id', 'username', 'first_name', 'last_name'] }
    ]
  }
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

// Equipment created without a site - most often a blank QR label printed ahead of
// time, before anyone knows where the item will end up - is physically still held by
// the unit, so file it under กฟฉ.2 instead of leaving it unassigned. Resolved by name
// rather than a hard-coded id so it survives the row being re-created.
const DEFAULT_PEA_SITE_NAME = 'กฟฉ.2';

const getDefaultPeaSiteId = async () => {
  const site = await PeaSite.findOne({
    where: { pea_name: DEFAULT_PEA_SITE_NAME },
    attributes: ['id']
  });

  if (!site) {
    console.warn(`[OfficeEquipment] Default site "${DEFAULT_PEA_SITE_NAME}" not found - creating equipment with no site.`);
    return null;
  }
  return site.id;
};

/**
 * Check for duplicate ip_address / mac_address / serial_number across office equipment
 * @param {Object} data - Data to check (ip_address, mac_address, serial_number)
 * @param {number|null} excludeId - ID to exclude (for updates)
 * @returns {Promise<{field: string, equipment_name: string, pea_site_name: string|null}|null>}
 *   Details of the conflicting record, or null if no duplicate
 */
const checkDuplicates = async (data, excludeId = null) => {
  const { Op } = require('sequelize');
  const uniqueFields = ['ip_address', 'mac_address', 'serial_number'];

  for (const field of uniqueFields) {
    const value = data[field];
    if (value) {
      const where = { [field]: value };
      if (excludeId) {
        where.id = { [Op.ne]: excludeId };
      }

      const existing = await OfficeEquipment.findOne({
        where,
        include: [{ model: PeaSite, as: 'pea_site', attributes: ['pea_name'] }]
      });
      if (existing) {
        return {
          field,
          equipment_name: existing.name,
          pea_site_name: existing.pea_site ? existing.pea_site.pea_name : null
        };
      }
    }
  }
  return null;
};

// Columns GET / may be sorted by. Anything outside this list is rejected up front -
// passing an unknown column straight to Sequelize would fail the query with a 500.
const SORTABLE_FIELDS = [
  'name', 'ip_address', 'mac_address', 'department', 'pea_site_id', 'equipment_type',
  'status', 'contract_no', 'contract_start_date', 'contract_expiry_date', 'vendor',
  'serial_number', 'asset_number', 'asset_owner', 'asset_owner_emp_id',
  'storage_location', 'createdAt', 'updatedAt'
];

/**
 * Get all office equipment, paginated. Optionally filtered by department,
 * equipment_type, pea_site_id, status, and searched by text - applied server-side
 * BEFORE pagination, so filtered results are always complete regardless of which
 * page they'd fall on unfiltered.
 *
 * Sorting: ?sort=<column>&order=asc|desc. Both are optional and default to
 * updatedAt DESC (most recently created or edited first), which is what this
 * endpoint returned before sorting was configurable.
 */
const getAllEquipment = async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { department, equipment_type, pea_site_id, exclude_pea_site_id, status, search, sort, order } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 20, 1);
    const offset = (page - 1) * limit;

    if (sort && !SORTABLE_FIELDS.includes(sort)) {
      return res.status(400).json({
        success: false,
        message: `Invalid sort field: "${sort}". Allowed fields: ${SORTABLE_FIELDS.join(', ')}`
      });
    }

    const sortField = sort || 'updatedAt';
    const sortDirection = String(order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    // id as a tiebreaker keeps paging stable when many rows share the same sort value
    const orderClause = [[sortField, sortDirection], ['id', 'DESC']];

    const where = {};
    if (department) where.department = department;
    if (equipment_type) where.equipment_type = equipment_type;
    if (pea_site_id) where.pea_site_id = pea_site_id;
    if (exclude_pea_site_id) {
      where.pea_site_id = {
        [Op.notIn]: String(exclude_pea_site_id).split(',').map(id => id.trim()).filter(Boolean)
      };
    }
    if (status) where.status = status;
    if (search) {
      where[Op.or] = ['name', 'asset_number', 'serial_number', 'ip_address', 'mac_address', 'asset_owner', 'asset_owner_emp_id']
        .map(field => ({ [field]: { [Op.substring]: search } }));
    }

    const { count, rows } = await OfficeEquipment.findAndCountAll({
      where,
      include: includeRelations,
      order: orderClause,
      limit,
      offset,
      distinct: true // avoid inflated count from the belongsToMany 'jobs' include
    });

    res.status(200).json({
      success: true,
      count: rows.length,
      sort: { field: sortField, order: sortDirection.toLowerCase() },
      data: rows.map(attachNetworkIp),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Text columns searchable individually via POST /search (substring, case-insensitive).
// Exact-match fields (pea_site_id, a numeric FK) are handled separately below.
const SEARCHABLE_TEXT_FIELDS = [
  'name', 'ip_address', 'mac_address', 'department', 'equipment_type', 'status',
  'notes', 'contract_no', 'vendor', 'serial_number', 'asset_number', 'asset_owner',
  'asset_owner_emp_id', 'storage_location'
];

/**
 * Advanced search: POST a body with any combination of equipment columns to filter
 * by, instead of cramming everything into GET query params. Each provided text field
 * does a substring match; all provided fields are ANDed together (narrows the result
 * as more fields are filled in). Same pagination/response shape as GET / above.
 */
const searchEquipment = async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const body = req.body || {};
    const page = Math.max(parseInt(body.page) || 1, 1);
    const limit = Math.max(parseInt(body.limit) || 20, 1);
    const offset = (page - 1) * limit;

    const where = {};
    for (const field of SEARCHABLE_TEXT_FIELDS) {
      const value = body[field];
      if (value !== undefined && value !== null && value !== '') {
        where[field] = { [Op.substring]: value };
      }
    }
    if (body.pea_site_id !== undefined && body.pea_site_id !== null && body.pea_site_id !== '') {
      where.pea_site_id = body.pea_site_id;
    }

    const { count, rows } = await OfficeEquipment.findAndCountAll({
      where,
      include: includeRelations,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      distinct: true // avoid inflated count from the belongsToMany 'jobs' include
    });

    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows.map(attachNetworkIp),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
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

    // Full detail view: site/current loan already come via includeRelations above;
    // round out with the asset-ownership change log and the complete borrow/return history.
    const [ownershipHistory, loanHistory] = await Promise.all([
      OfficeEquipmentAuditLog.findAll({
        where: { equipment_id: id, action: 'ASSET_INFO_CHANGE' },
        order: [['createdAt', 'DESC']]
      }),
      OfficeEquipmentLoan.findAll({
        where: { equipment_id: id },
        include: [{ model: User, as: 'borrowed_by', attributes: ['id', 'username', 'first_name', 'last_name'] }],
        order: [['borrowed_at', 'DESC']]
      })
    ]);

    const data = attachNetworkIp(equipment);
    data.ownership_history = ownershipHistory;
    data.loan_history = loanHistory;

    res.status(200).json({
      success: true,
      data
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

    const duplicate = await checkDuplicates({ ip_address, mac_address, serial_number: otherData.serial_number });
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: `ตรวจพบอุปกรณ์ที่มี ${duplicate.field} นี้ (ชื่อ: "${duplicate.equipment_name}", สำนักงาน: "${duplicate.pea_site_name || 'ไม่ระบุ'}")`
      });
    }

    // A form that leaves an optional field untouched sends "" rather than omitting it.
    // MySQL coerces "" to 0 for an INTEGER column, so an unselected pea_site_id used to
    // hit the peasites foreign key as id 0 and fail the whole insert with a 500 (same
    // trap for the DATEONLY contract fields). Every column here is nullable, so treat a
    // blank string as "not provided" - which is what updateEquipment already does.
    const normalizedData = Object.fromEntries(
      Object.entries(otherData).map(([key, value]) => [key, value === '' ? null : value])
    );

    // No site given (field omitted entirely, or blanked by the form) -> fall back to กฟฉ.2
    if (normalizedData.pea_site_id === undefined || normalizedData.pea_site_id === null) {
      normalizedData.pea_site_id = await getDefaultPeaSiteId();
    }

    const equipmentData = {
      name,
      ip_address: ip_address || null,
      mac_address: mac_address || null,
      ...normalizedData,
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

    // Block manual status changes while equipment is out on an open loan - the
    // caller must return it first (POST /:id/return) so returned_at gets set
    // properly, rather than editing status directly and losing that record.
    if (body.status !== undefined && body.status !== '' && body.status !== equipment.status) {
      const openLoan = await OfficeEquipmentLoan.findOne({
        where: { equipment_id: id, returned_at: null }
      });
      if (openLoan) {
        return res.status(400).json({
          success: false,
          message: 'Cannot change status while equipment is borrowed and not yet returned. Return it first via POST /:id/return.'
        });
      }
    }

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

    if (updateData.ip_address || updateData.mac_address || updateData.serial_number) {
      const duplicate = await checkDuplicates(
        { ip_address: updateData.ip_address, mac_address: updateData.mac_address, serial_number: updateData.serial_number },
        id
      );
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: `ตรวจพบอุปกรณ์ที่มี ${duplicate.field} นี้ (ชื่อ: "${duplicate.equipment_name}", สำนักงาน: "${duplicate.pea_site_name || 'ไม่ระบุ'}")`
        });
      }
    }

    // Capture old -> new values for asset-ownership fields before they're overwritten,
    // so the history endpoint can show who/what it changed from.
    const assetChanges = {};
    for (const field of ASSET_TRACKED_FIELDS) {
      if (updateData[field] !== undefined) {
        assetChanges[field] = { old: equipment[field], new: updateData[field] };
      }
    }

    await equipment.update(updateData);

    await logAudit(req, 'UPDATE', equipment, updateData);

    if (Object.keys(assetChanges).length > 0) {
      await logAudit(req, 'ASSET_INFO_CHANGE', equipment, assetChanges);
    }

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
const escapeXml = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// Printed on the QR label when the equipment has no PEA site at all. New equipment
// always gets a site (unassigned ones default to กฟฉ.2), so this only covers older
// rows recorded before that default existed.
const LABEL_FALLBACK_UNIT = 'กดส.ฉ.2';

const getEquipmentQrCode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const equipment = await OfficeEquipment.findByPk(id, {
      include: [{ model: PeaSite, as: 'pea_site', attributes: ['pea_name'] }]
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Office equipment not found'
      });
    }

    const qrContent = `${process.env.QR_CODE_URL}${equipment.id}`;
    const qrSize = 300;
    const qrBuffer = await QRCode.toBuffer(qrContent, { type: 'png', width: qrSize, margin: 2 });

    // Caption printed below the QR code so the physical label is self-explanatory
    // without scanning it: where it belongs, equipment name, asset/serial info (if
    // set), and its ID. The first line is the equipment's own PEA site, so a label
    // says where the item actually sits rather than which unit owns it.
    const PLACEHOLDER_NAME = 'อุปกรณ์ใหม่ (รอกรอกข้อมูล)';
    const siteName = equipment.pea_site ? equipment.pea_site.pea_name : null;
    const labelLines = [siteName || LABEL_FALLBACK_UNIT];
    if (equipment.name !== PLACEHOLDER_NAME) labelLines.push(equipment.name);
    if (equipment.asset_number) labelLines.push(`รหัสทรัพย์สิน: ${equipment.asset_number}`);
    if (equipment.serial_number) labelLines.push(`SN: ${equipment.serial_number}`);
    labelLines.push(`ID: ${equipment.id}`);
    const lineHeight = 26;
    const padding = 12;
    const textAreaHeight = labelLines.length * lineHeight + padding * 2;
    const canvasHeight = qrSize + textAreaHeight;

    const textSvg = `
      <svg width="${qrSize}" height="${textAreaHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        ${labelLines.map((line, i) => `<text x="50%" y="${padding + lineHeight * (i + 1) - 8}" font-family="Tahoma, Leelawadee UI, sans-serif" font-size="18" fill="black" text-anchor="middle">${escapeXml(line)}</text>`).join('')}
      </svg>
    `;

    const buffer = await sharp({
      create: { width: qrSize, height: canvasHeight, channels: 4, background: 'white' }
    })
      .composite([
        { input: qrBuffer, top: 0, left: 0 },
        { input: Buffer.from(textSvg), top: qrSize, left: 0 }
      ])
      .png()
      .toBuffer();

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
    const { due_date, notes, borrower_name, borrower_emp_id, borrower_contact } = req.body;

    if (!borrower_name) {
      return res.status(400).json({ success: false, message: 'borrower_name is required' });
    }

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
      // borrowed_by_user_id is the logged-in staff who processed this scan, not
      // the borrower - the borrower is whoever was entered manually below.
      borrowed_by_user_id: req.user ? req.user.id : null,
      borrower_name,
      borrower_emp_id: borrower_emp_id || null,
      borrower_contact: borrower_contact || null,
      borrowed_at: new Date(),
      due_date: due_date || null,
      notes: notes || null,
      batch_id: crypto.randomUUID() // a "batch of one" - keeps grouped-display logic uniform
    });

    await equipment.update({ status: 'ถูกยืม' });

    await logAudit(req, 'BORROW', equipment, { loan_id: loan.id, borrower_name, due_date: loan.due_date });

    // Fire-and-forget: don't let a slow/unreachable Teams webhook delay the response
    notifyEquipmentLoanEvent(loan, equipment, 'borrow');

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
 * Borrow several pieces of equipment in one action (e.g. a laptop + a projector for
 * one event) - one borrower payload, one batch_id shared across every resulting loan
 * row, so they can be displayed/grouped together as a single borrowing event. All-or-
 * nothing: if any equipment ID is invalid or already borrowed, nothing is created.
 */
const borrowEquipmentBatch = async (req, res, next) => {
  try {
    const { equipment_ids, due_date, notes, borrower_name, borrower_emp_id, borrower_contact } = req.body;

    if (!borrower_name) {
      return res.status(400).json({ success: false, message: 'borrower_name is required' });
    }
    if (!equipment_ids || !Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'equipment_ids (non-empty array) is required' });
    }

    const equipmentList = await OfficeEquipment.findAll({ where: { id: equipment_ids } });
    if (equipmentList.length !== equipment_ids.length) {
      return res.status(404).json({ success: false, message: 'One or more equipment IDs were not found' });
    }

    const alreadyBorrowed = await OfficeEquipmentLoan.findAll({
      where: { equipment_id: equipment_ids, returned_at: null }
    });
    if (alreadyBorrowed.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'One or more equipment items are already borrowed and have not been returned yet',
        equipment_ids: alreadyBorrowed.map(l => l.equipment_id)
      });
    }

    const batchId = crypto.randomUUID();
    const borrowedAt = new Date();

    await OfficeEquipmentLoan.bulkCreate(
      equipmentList.map(equipment => ({
        equipment_id: equipment.id,
        borrowed_by_user_id: req.user ? req.user.id : null,
        borrower_name,
        borrower_emp_id: borrower_emp_id || null,
        borrower_contact: borrower_contact || null,
        borrowed_at: borrowedAt,
        due_date: due_date || null,
        notes: notes || null,
        batch_id: batchId
      }))
    );

    // Re-fetch rather than trust bulkCreate's return value - MySQL doesn't
    // support RETURNING, so per-row ids aren't reliably populated otherwise.
    const loans = await OfficeEquipmentLoan.findAll({ where: { batch_id: batchId } });

    await OfficeEquipment.update(
      { status: 'ถูกยืม' },
      { where: { id: equipment_ids } }
    );

    for (const equipment of equipmentList) {
      await logAudit(req, 'BORROW', equipment, { batch_id: batchId, borrower_name, due_date: due_date || null });
    }

    // Fire-and-forget: one consolidated Teams message for the whole batch, not one per item
    notifyEquipmentLoanBatchEvent(loans, equipmentList, 'borrow');

    res.status(201).json({
      success: true,
      message: `${loans.length} equipment item(s) marked as borrowed`,
      batch_id: batchId,
      data: loans
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

    await equipment.update({ status: 'ใช้งาน' });

    await logAudit(req, 'RETURN', equipment, { loan_id: openLoan.id });

    // Fire-and-forget: don't let a slow/unreachable Teams webhook delay the response
    notifyEquipmentLoanEvent(openLoan, equipment, 'return');

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
 * Full loan history across ALL equipment, paginated - each row carries its batch_id
 * so items borrowed together in one action (POST /borrow-batch) stay grouped/adjacent
 * (rows in the same batch share the same borrowed_at, so ordering by borrowed_at keeps
 * them next to each other). Optionally filtered by status (open/returned), equipment_id,
 * pea_site_id (of the equipment), or a borrower_name/emp_id search.
 */
const getAllLoans = async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { status, equipment_id, pea_site_id, search } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 20, 1);
    const offset = (page - 1) * limit;

    const where = {};
    if (status === 'open') where.returned_at = null;
    if (status === 'returned') where.returned_at = { [Op.ne]: null };
    if (equipment_id) where.equipment_id = equipment_id;
    if (search) {
      where[Op.or] = ['borrower_name', 'borrower_emp_id', 'borrower_contact']
        .map(field => ({ [field]: { [Op.substring]: search } }));
    }

    const equipmentInclude = {
      model: OfficeEquipment,
      as: 'equipment',
      attributes: ['id', 'name', 'asset_number', 'pea_site_id']
    };
    if (pea_site_id) equipmentInclude.where = { pea_site_id };

    const { count, rows } = await OfficeEquipmentLoan.findAndCountAll({
      where,
      include: [
        equipmentInclude,
        { model: User, as: 'borrowed_by', attributes: ['id', 'username', 'first_name', 'last_name'] }
      ],
      order: [['borrowed_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset
    });

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get the full audit/change history for a piece of equipment (create, update,
 * delete, borrow, return, asset-info changes, etc.), newest first.
 */
const getEquipmentHistory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const logs = await OfficeEquipmentAuditLog.findAll({
      where: { equipment_id: id },
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
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
  searchEquipment,
  getEquipmentBySite,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getEquipmentQrCode,
  borrowEquipment,
  borrowEquipmentBatch,
  returnEquipment,
  getEquipmentLoanHistory,
  getAllLoans,
  getEquipmentHistory,
  uploadEquipmentPhotos,
  deleteEquipmentPhoto,
  uploadStorageLocationPhoto
};
