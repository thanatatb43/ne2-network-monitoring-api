'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DevicesAvailability extends Model {
    static associate(models) {
      DevicesAvailability.belongsTo(models.NetworkDevices, {
        foreignKey: 'device_id',
        as: 'device'
      });
    }
  }

  DevicesAvailability.init({
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    daily_ava: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    weekly_ava: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    monthly_ava: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    yearly_ava: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'DevicesAvailability',
    tableName: 'DevicesAvailability',
    timestamps: true,
    indexes: [
      { fields: ['device_id'] }
    ]
  });

  return DevicesAvailability;
};
