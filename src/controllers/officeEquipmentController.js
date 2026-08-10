const net = require('net');
const { OfficeEquipment, OfficeEquipmentAuditLog, PeaSite, User, NetworkDevices } = require('../models');

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

module.exports = {
  getAllEquipment,
  getEquipmentBySite,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment
};
