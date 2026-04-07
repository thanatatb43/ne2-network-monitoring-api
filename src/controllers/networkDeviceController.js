const { NetworkDevices } = require('../models');

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

module.exports = {
  getAllDevices,
  getDeviceById
};
