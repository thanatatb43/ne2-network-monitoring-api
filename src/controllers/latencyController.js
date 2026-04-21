const { NetworkDevices, LatencyLogs, LatencyRecent, DeviceMetrics, DevicesAvailability, Sequelize } = require('../models');
const ping = require('ping');

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

/**
 * Get availability stats for a single device by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDeviceAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;

    const availability = await DevicesAvailability.findOne({
      where: { device_id: id },
      include: [
        {
          model: NetworkDevices,
          as: 'device',
          attributes: ['pea_name', 'province', 'gateway']
        }
      ]
    });

    if (!availability) {
      return res.status(404).json({
        success: false,
        message: 'Availability data not found for this device'
      });
    }

    res.status(200).json({
      success: true,
      data: availability
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get quick status summary (Online vs Offline counts)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStatusSummary = async (req, res, next) => {
  try {
    const stats = await DeviceMetrics.findAll({
      attributes: [
        'status',
        [Sequelize.fn('COUNT', Sequelize.col('device_id')), 'count'],
        [Sequelize.fn('AVG', Sequelize.col('latency_ms')), 'avg_latency']
      ],
      group: ['status'],
      raw: true
    });

    const summary = {
      total: 0,
      online: 0,
      offline: 0,
      avg_latency: 0
    };

    let totalLatency = 0;
    let latencyCount = 0;

    stats.forEach(s => {
      const count = parseInt(s.count);
      summary.total += count;
      if (s.status === 'up') {
        summary.online = count;
        if (s.avg_latency) {
          totalLatency += parseFloat(s.avg_latency) * count;
          latencyCount += count;
        }
      } else {
        summary.offline = count;
      }
    });

    summary.avg_latency = latencyCount > 0 ? (totalLatency / latencyCount).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Perform a live on-demand ping check for a device
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const checkDeviceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = await NetworkDevices.findByPk(id);

    if (!device || !device.gateway) {
      return res.status(404).json({
        success: false,
        message: 'Device not found or has no gateway IP'
      });
    }

    // Perform live ping (3 packets for reliability)
    const result = await ping.promise.probe(device.gateway, {
      timeout: 5,
      extra: ['-n', '3']
    });

    const response = {
      device_id: device.id,
      pea_name: device.pea_name,
      gateway: device.gateway,
      status: result.alive ? 'up' : 'down',
      latency_ms: result.alive ? parseFloat(result.avg) : null,
      packet_loss: result.alive ? parseFloat(result.packetLoss) : 100,
      checked_at: new Date().toISOString()
    };

    // Update metrics table with this fresh check
    await DeviceMetrics.upsert({
      device_id: device.id,
      latency_ms: response.latency_ms,
      packet_loss: response.packet_loss,
      status: response.status,
      checked_at: response.checked_at
    });

    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAverageLatency,
  getRecentLatency,
  getRecentLatencySummary,
  getDeviceMetrics,
  getDeviceAvailability,
  getStatusSummary,
  checkDeviceStatus
};

