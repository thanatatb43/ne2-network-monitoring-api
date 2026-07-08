'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaSite extends Model {
    static associate(models) {
      // Define associations here if needed in the future
      // Example: PeaSite.hasMany(models.NetworkDevices, { foreignKey: 'site_id' });
    }
  }

  PeaSite.init({
    pea_name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true
      }
    },
    pea_province: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    }
  }, {
    sequelize,
    modelName: 'PeaSite',
    tableName: 'PeaSites',
    timestamps: true,
  });

  return PeaSite;
};
