'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DeviceDowntime extends Model {
    static associate(models) {
      DeviceDowntime.belongsTo(models.NetworkDevices, {
        foreignKey: 'device_id',
        as: 'device'
      });
    }
  }

  DeviceDowntime.init({
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    down_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    up_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    duration_ms: {
      type: DataTypes.BIGINT,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING, // 'down', 'up'
      defaultValue: 'down'
    }
  }, {
    sequelize,
    modelName: 'DeviceDowntime',
    tableName: 'DeviceDowntimes',
    timestamps: true,
    indexes: [
      { fields: ['device_id'] },
      { fields: ['down_at'] },
      { fields: ['status'] }
    ]
  });

  return DeviceDowntime;
};
