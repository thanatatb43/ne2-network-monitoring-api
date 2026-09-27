const { NetworkDevices, LatencyLogs, LatencyRecent, DeviceMetrics, DevicesAvailability, DailyAvailabilitySnapshot, Sequelize } = require('../models');
const { Op } = Sequelize;
const { sendTeamsNotification } = require('../services/notificationService');
const { probeDevice } = require('../services/deviceProbe');
const { describeLiveStatus, liveStatusMeta } = require('../services/deviceLiveStatus');

// Adds live_status / alive / stale / age_seconds next to the stored fields, which are
// left exactly as they were. See deviceLiveStatus.js for the precedence rules.
const withLiveStatus = (metric, nowMs) => {
  const json = metric.toJSON ? metric.toJSON() : metric;
  return { ...json, ...describeLiveStatus(json, nowMs) };
};

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
        [Sequelize.fn('AVG', Sequelize.literal('NULLIF(latency_ms, 0)')), 'avg_latency'],
        [Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'avg_packet_loss'],
      ],
      include: [
        {
          model: NetworkDevices,
          as: 'device',
          attributes: ['pea_name', 'pea_type', 'province', 'gateway'],
          required: true
        }
      ],
      group: ['device_id', 'device.id'],
      // Sort from better latency to worse latency (lowest to highest)
      // Non-null values first, then by latency ASC, then by packet loss ASC
      order: [
        [Sequelize.literal('AVG(latency_ms) IS NULL'), 'ASC'],
        [Sequelize.literal('AVG(latency_ms)'), 'ASC'],
        [Sequelize.literal('AVG(packet_loss)'), 'ASC']
      ]
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
          attributes: ['pea_name', 'pea_type', 'province', 'gateway'],
          required: true
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
    const offsetHours = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET) : 0;
    const nowWithOffset = new Date(new Date().getTime() + offsetHours * 60 * 60 * 1000);
    const tenMinutesAgo = new Date(nowWithOffset.getTime() - 10 * 60 * 1000);

    const summary = await LatencyRecent.findAll({
      where: {
        checked_at: {
          [Op.gte]: tenMinutesAgo
        }
      },
      attributes: [
        [Sequelize.fn('DATE_FORMAT', Sequelize.col('checked_at'), '%Y-%m-%d %H:%i:00'), 'minute'],
        [Sequelize.fn('AVG', Sequelize.literal('NULLIF(latency_ms, 0)')), 'avg_latency'],
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
          attributes: ['pea_name', 'pea_type', 'province', 'gateway'],
          required: true
        }
      ],
      // Sort from better latency to worse latency (lowest to highest)
      // Non-null values first, then by latency ASC, then by packet loss ASC
      order: [
        [Sequelize.literal('latency_ms IS NULL'), 'ASC'],
        ['latency_ms', 'ASC'],
        ['packet_loss', 'ASC']
      ]
    });

    const nowMs = Date.now();
    res.status(200).json({
      success: true,
      count: metrics.length,
      data: metrics.map((m) => withLiveStatus(m, nowMs)),
      meta: { generated_at: new Date(nowMs).toISOString(), ...liveStatusMeta() }
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
          attributes: ['pea_name', 'pea_type', 'province', 'gateway'],
          required: true
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
        [Sequelize.fn('AVG', Sequelize.literal('NULLIF(latency_ms, 0)')), 'avg_latency']
      ],
      include: [{
        model: NetworkDevices,
        as: 'device',
        attributes: [],
        required: true
      }],
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
        summary.online += count;
        if (s.avg_latency) {
          totalLatency += parseFloat(s.avg_latency) * count;
          latencyCount += count;
        }
      } else {
        summary.offline += count;
      }
    });

    summary.avg_latency = latencyCount > 0 ? (totalLatency / latencyCount).toFixed(2) : 0;

    // online/offline above count the raw last measurement, stale ones included, and are
    // kept as-is for existing callers. `live` counts only results that are still current.
    const nowMs = Date.now();
    const rows = await DeviceMetrics.findAll({
      attributes: ['status', 'checked_at'],
      include: [{ model: NetworkDevices, as: 'device', attributes: [], required: true }],
      raw: true
    });
    summary.live = { online: 0, offline: 0, unknown: 0 };
    rows.forEach((r) => {
      const { live_status } = describeLiveStatus(r, nowMs);
      if (live_status === 'up') summary.live.online++;
      else if (live_status === 'down') summary.live.offline++;
      else summary.live.unknown++;
    });

    res.status(200).json({
      success: true,
      data: summary,
      meta: { generated_at: new Date(nowMs).toISOString(), ...liveStatusMeta() }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all devices currently in 'down' status (based on latest DeviceMetrics)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDownDevices = async (req, res, next) => {
  try {
    const downDevices = await DeviceMetrics.findAll({
      where: { status: 'down' },
      include: [
        {
          model: NetworkDevices,
          as: 'device',
          attributes: ['pea_name', 'pea_type', 'province', 'gateway'],
          required: true
        }
      ],
      order: [['checked_at', 'DESC']]
    });

    // Still every device whose LAST measurement was down (unchanged, for existing
    // callers) - but each now says whether that result is current. A device the loop
    // hasn't reached in a while comes back live_status 'unknown', not 'down'.
    const nowMs = Date.now();
    const data = downDevices.map((m) => withLiveStatus(m, nowMs));
    res.status(200).json({
      success: true,
      count: data.length,
      data,
      meta: {
        generated_at: new Date(nowMs).toISOString(),
        currently_down: data.filter((d) => d.live_status === 'down').length,
        stale_down: data.filter((d) => d.stale).length,
        ...liveStatusMeta()
      }
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

    // Same probe as the background loop - gateway, WAN fallback, one retry. This used
    // to probe once with no retry, so a single blip on a manual check recorded "down"
    // and fired a Teams alert straight away.
    const probe = await probeDevice(device);
    const newStatus = probe.status;

    // Check for status change for notification
    const currentMetric = await DeviceMetrics.findOne({ where: { device_id: device.id } });
    if (currentMetric && currentMetric.status !== newStatus) {
      sendTeamsNotification(device, newStatus, currentMetric.status);
    }

    const response = {
      device_id: device.id,
      pea_name: device.pea_name,
      gateway: device.gateway,
      status: newStatus,
      latency_ms: probe.latency_ms,
      packet_loss: probe.packet_loss,
      checked_at: probe.measured_at.toISOString(),
      // Additive (N1): just measured, so always fresh.
      live_status: newStatus,
      alive: probe.alive,
      probed_ip: probe.probed_ip,
      attempts: probe.attempts
    };

    // Update metrics table with this fresh check
    await DeviceMetrics.upsert({
      device_id: device.id,
      latency_ms: response.latency_ms,
      packet_loss: response.packet_loss,
      status: response.status,
      checked_at: response.checked_at
    });

    // This writes DeviceMetrics and can fire a Teams alert, so it belongs on POST.
    // GET still works for existing callers but is flagged deprecated - see
    // docs/REMAINING_UX_UI_BACKEND_RESPONSE.md, N1, for the removal plan.
    const body = { success: true, data: response };
    if (req.method === 'GET') {
      res.set('Deprecation', 'true');
      res.set('Link', `</api/latency/check/${device.id}>; rel="successor-version"; method="POST"`);
      body.meta = {
        deprecations: ['GET /api/latency/check/:id changes monitoring state and can send a Teams alert - call it with POST instead. GET will be removed once no caller uses it.']
      };
    }
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all daily availability snapshots sorted by device_id
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAvailabilitySnapshots = async (req, res, next) => {
  try {
    const snapshots = await DailyAvailabilitySnapshot.findAll({
      order: [
        ['device_id', 'ASC'],
        ['date', 'ASC']
      ],
      include: [{
        model: NetworkDevices,
        as: 'device',
        attributes: ['pea_name', 'gateway'],
        required: true
      }]
    });

    res.status(200).json({
      success: true,
      data: snapshots
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get daily availability snapshots for a specific device
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDeviceAvailabilitySnapshots = async (req, res, next) => {
  try {
    const { id } = req.params;
    const snapshots = await DailyAvailabilitySnapshot.findAll({
      where: { device_id: id },
      order: [
        ['date', 'ASC']
      ],
      include: [{
        model: NetworkDevices,
        as: 'device',
        attributes: ['pea_name', 'gateway'],
        required: true
      }]
    });

    res.status(200).json({
      success: true,
      data: snapshots
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
  getDownDevices,
  checkDeviceStatus,
  getAvailabilitySnapshots,
  getDeviceAvailabilitySnapshots
};

