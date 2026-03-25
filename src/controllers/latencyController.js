const { NetworkDevices, LatencyLogs, LatencyRecent, DeviceMetrics, Sequelize } = require('../models');

/**
 * Get average latency per device
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAverageLatency = async (req, res, next) => {
  try {
    const averages = await LatencyLogs.findAll({
      attributes: [
        'device_id',
        [Sequelize.fn('AVG', Sequelize.col('latency_ms')), 'avg_latency'],
        [Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'avg_packet_loss'],
      ],
      include: [
        {
          model: NetworkDevices,
          as: 'device',
          attributes: ['pea_name', 'province', 'gateway']
        }
      ],
      group: ['device_id', 'device.id'],
      order: [[Sequelize.literal('avg_latency'), 'DESC']]
    });

    res.status(200).json({
      success: true,
      data: averages
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get recent latency (last 10 minutes)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getRecentLatency = async (req, res, next) => {
  try {
    const recents = await LatencyRecent.findAll({
      include: [
        {
          model: NetworkDevices,
          as: 'device',
          attributes: ['pea_name', 'province', 'gateway']
        }
      ],
      order: [['checked_at', 'DESC']]
    });

    res.status(200).json({
      success: true,
      count: recents.length,
      data: recents
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get 10-minute summary of average latency (for graphing)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getRecentLatencySummary = async (req, res, next) => {
  try {
    const summary = await LatencyRecent.findAll({
      attributes: [
        [Sequelize.fn('DATE_FORMAT', Sequelize.col('checked_at'), '%Y-%m-%d %H:%i:00'), 'minute'],
        [Sequelize.fn('AVG', Sequelize.col('latency_ms')), 'avg_latency'],
        [Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'avg_packet_loss'],
      ],
      group: [Sequelize.fn('DATE_FORMAT', Sequelize.col('checked_at'), '%Y-%m-%d %H:%i:00')],
      order: [[Sequelize.literal('minute'), 'ASC']]
    });

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get latest metrics for all devices (live status snapshot)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDeviceMetrics = async (req, res, next) => {
  try {
    const metrics = await DeviceMetrics.findAll({
      include: [
        {
          model: NetworkDevices,
          as: 'device',
          attributes: ['pea_name', 'province', 'gateway']
        }
      ],
      order: [['checked_at', 'DESC']]
    });

    res.status(200).json({
      success: true,
      count: metrics.length,
      data: metrics
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAverageLatency,
  getRecentLatency,
  getRecentLatencySummary,
  getDeviceMetrics
};
