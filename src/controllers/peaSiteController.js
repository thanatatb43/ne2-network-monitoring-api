const { PeaSite } = require('../models');

// Get all PEA sites (including id, name, and province)
const getAllSites = async (req, res, next) => {
  try {
    const sites = await PeaSite.findAll({
      attributes: ['id', 'pea_name', 'pea_province'],
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

module.exports = {
  getAllSites
};
