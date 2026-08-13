const { PeaSite, NetworkDevices, DeviceMetrics, OfficeEquipment, PeaJob } = require('../models');

// Include the linked network device plus its latest status, shared by the list and single-site reads
const networkDeviceInclude = {
  model: NetworkDevices,
  as: 'network_device',
  attributes: ['id', 'pea_name', 'gateway'],
  include: [
    { model: DeviceMetrics, as: 'metrics', attributes: ['status', 'latency_ms', 'checked_at'] }
  ]
};

// Get all PEA sites (including id, name, province, coordinates, and linked device status)
const getAllSites = async (req, res, next) => {
  try {
    const sites = await PeaSite.findAll({
      attributes: ['id', 'pea_name', 'pea_province', 'pea_type', 'latitude', 'longitude'],
      include: [networkDeviceInclude],
      order: [['pea_name', 'ASC']]
    });

    res.status(200).json({
      success: true,
      data: sites
    });
  } catch (error) {
    next(error);
  }
};

// Get a single PEA site, including which network device is linked to it (if any) and its status
const getSiteById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const site = await PeaSite.findByPk(id, {
      include: [networkDeviceInclude]
    });

    if (!site) {
      return res.status(404).json({ success: false, message: 'PEA site not found' });
    }

    res.status(200).json({ success: true, data: site });
  } catch (error) {
    next(error);
  }
};

/**
 * Parses a coordinate pair pasted directly from Google Maps
 * (e.g. "16.246825, 102.821954" - right-click a point -> click the coordinates
 * to copy). Rejects anything else (DMS strings, swapped order, out-of-range
 * values, missing comma, etc.) rather than trying to guess intent.
 */
const parseGoogleMapsCoordinates = (coordinates) => {
  if (typeof coordinates !== 'string') return null;

  const match = coordinates.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;

  const latitude = parseFloat(match[1]);
  const longitude = parseFloat(match[2]);

  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
};

// Create a new PEA site
const createSite = async (req, res, next) => {
  try {
    const { pea_name, pea_province, pea_type, coordinates } = req.body;

    if (!pea_name || !pea_province) {
      return res.status(400).json({ success: false, message: 'pea_name and pea_province are required' });
    }

    const data = { pea_name, pea_province, pea_type: pea_type || null };

    if (coordinates !== undefined) {
      const parsed = parseGoogleMapsCoordinates(coordinates);
      if (!parsed) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates format. Expected the exact "lat, long" string copied from Google Maps, e.g. "16.246825, 102.821954"'
        });
      }
      Object.assign(data, parsed);
    }

    const site = await PeaSite.create(data);

    res.status(201).json({ success: true, message: 'Site created successfully', data: site });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'A site with this name already exists' });
    }
    next(error);
  }
};

// Update a PEA site's name, province, and/or coordinates (partial update)
const updateSite = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pea_name, pea_province, pea_type, coordinates } = req.body;

    const site = await PeaSite.findByPk(id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'PEA site not found' });
    }

    const updateData = {};
    if (pea_name !== undefined && pea_name !== '') updateData.pea_name = pea_name;
    if (pea_province !== undefined && pea_province !== '') updateData.pea_province = pea_province;
    if (pea_type !== undefined && pea_type !== '') updateData.pea_type = pea_type;

    if (coordinates !== undefined) {
      const parsed = parseGoogleMapsCoordinates(coordinates);
      if (!parsed) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates format. Expected the exact "lat, long" string copied from Google Maps, e.g. "16.246825, 102.821954"'
        });
      }
      Object.assign(updateData, parsed);
    }

    await site.update(updateData);

    res.status(200).json({ success: true, message: 'Site updated successfully', data: site });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'A site with this name already exists' });
    }
    next(error);
  }
};

// Delete a PEA site - blocked if a network device, office equipment, or PEA job still references it
const deleteSite = async (req, res, next) => {
  try {
    const { id } = req.params;

    const site = await PeaSite.findByPk(id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'PEA site not found' });
    }

    const [linkedDevice, equipmentCount, jobCount] = await Promise.all([
      NetworkDevices.findOne({ where: { pea_site_id: id } }),
      OfficeEquipment.count({ where: { pea_site_id: id } }),
      PeaJob.count({ where: { pea_site_id: id } })
    ]);

    if (linkedDevice || equipmentCount > 0 || jobCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete this site: it still has a linked network device, office equipment, and/or PEA jobs. Unlink or remove those first.'
      });
    }

    await site.destroy();

    res.status(200).json({ success: true, message: 'Site deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllSites,
  getSiteById,
  createSite,
  updateSite,
  deleteSite
};
