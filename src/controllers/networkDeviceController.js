const { NetworkDevices, DeviceAuditLog } = require('../models');

/**
 * Helper to log device actions for auditing
 */
const logAudit = async (req, action, device, data) => {
  try {
    await DeviceAuditLog.create({
      device_id: device ? device.id : null,
      action,
      pea_name: device ? device.pea_name : (data ? data.pea_name : null),
      data: data || (device ? device.toJSON() : null),
      user_id: req.user ? req.user.id : null,
      user_name: req.user ? req.user.name || req.user.username : 'Unknown'
    });
  } catch (error) {
    console.error('Audit logging failed:', error);
  }
};

/**
 * Get all network devices
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllDevices = async (req, res, next) => {
  try {
    const devices = await NetworkDevices.findAll();
    res.status(200).json({
      success: true,
      data: devices
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single network device by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDeviceById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = await NetworkDevices.findByPk(id);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Network device not found'
      });
    }

    res.status(200).json({
      success: true,
      data: device
    });
  } catch (error) {
    next(error);
  }
};

const net = require('net');

/**
 * Check for duplicate values in specific fields
 * @param {Object} data - Data to check
 * @param {number|null} excludeId - ID to exclude (for updates)
 * @returns {Promise<string|null>} - Returns the name of the field that is duplicate, or null
 */
const checkDuplicates = async (data, excludeId = null) => {
  const { Op } = require('sequelize');
  const uniqueFields = [
    'pea_name', 'gateway', 'network_id', 'sub_ip1_gateway', 'sub_ip2_gateway', 
    'wan_gateway_mpls', 'wan_ip_fgt', 'vpn_main', 'vpn_backup', 'gateway_backup'
  ];

  for (const field of uniqueFields) {
    const value = data[field];
    
    // Only check if value is provided and is not a placeholder like '-'
    if (value && value !== '' && value !== '-') {
      const where = { [field]: value };
      if (excludeId) {
        where.id = { [Op.ne]: excludeId };
      }
      
      const existing = await NetworkDevices.findOne({ where });
      if (existing) {
        return field;
      }
    }
  }
  return null;
};

/**
 * Create a new network device
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createDevice = async (req, res, next) => {
  try {
    const { pea_name, ...otherData } = req.body;

    // 1. Basic validation
    if (!pea_name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: pea_name is required'
      });
    }

    // List of fields that MUST be valid IPv4 if provided
    const ipv4Fields = [
      'gateway', 'network_id', 'sub_ip1_gateway', 'sub_ip2_gateway', 
      'wan_gateway_mpls', 'wan_ip_fgt', 'vpn_main', 'vpn_backup'
    ];

    const deviceData = { pea_name };

    for (const [key, value] of Object.entries(otherData)) {
      // Filter out empty fields
      if (value === '' || value === null) {
        continue;
      }

      // IPv4 validation
      if (ipv4Fields.includes(key)) {
        if (!net.isIPv4(value)) {
          return res.status(400).json({
            success: false,
            message: `Invalid IPv4 address for field: ${key}`
          });
        }
      }

      deviceData[key] = value;
    }

    // 2. Duplicate Check
    const duplicateField = await checkDuplicates(deviceData);
    if (duplicateField) {
      return res.status(400).json({
        success: false,
        message: `A device with this ${duplicateField} already exists`
      });
    }

    const newDevice = await NetworkDevices.create(deviceData);

    // Audit Log
    await logAudit(req, 'CREATE', newDevice);

    res.status(201).json({
      success: true,
      message: 'Network device created successfully',
      data: newDevice
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update network device by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = await NetworkDevices.findByPk(id);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Network device not found'
      });
    }

    // List of fields that MUST be valid IPv4 if provided
    const ipv4Fields = [
      'gateway', 'network_id', 'sub_ip1_gateway', 'sub_ip2_gateway', 
      'wan_gateway_mpls', 'wan_ip_fgt', 'vpn_main', 'vpn_backup'
    ];

    const updateData = {};
    const { id: _, createdAt, updatedAt, index, ...body } = req.body;

    for (const [key, value] of Object.entries(body)) {
      // 1. Prevent empty fields (if provided, must not be empty string or null)
      if (value === '' || value === null) {
        continue; // Skip empty fields
      }

      // 2. If the field has the same value, do not update it
      if (device[key] === value) {
        continue; // Skip if same value
      }

      // 3. IPv4 validation for specific fields
      if (ipv4Fields.includes(key)) {
        if (!net.isIPv4(value)) {
          return res.status(400).json({
            success: false,
            message: `Invalid IPv4 address for field: ${key}`
          });
        }
      }

      updateData[key] = value;
    }

    // 4. Duplicate Check
    if (Object.keys(updateData).length > 0) {
      const duplicateField = await checkDuplicates({ ...device.toJSON(), ...updateData }, id);
      if (duplicateField) {
        return res.status(400).json({
          success: false,
          message: `A device with this ${duplicateField} already exists`
        });
      }
    }

    // If no fields to update after filtering
    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected. Everything is already up to date.'
      });
    }
    
    await device.update(updateData);

    // Audit Log
    await logAudit(req, 'UPDATE', device, updateData);

    res.status(200).json({
      success: true,
      message: 'Network device updated successfully',
      data: device
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete network device by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = await NetworkDevices.findByPk(id);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Network device not found'
      });
    }

    // Audit Log: Store full device data before deletion
    await logAudit(req, 'DELETE', device);

    await device.destroy();

    res.status(200).json({
      success: true,
      message: 'Network device deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice
};
