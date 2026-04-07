'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DeviceMetrics extends Model {
    static associate(models) {
      DeviceMetrics.belongsTo(models.NetworkDevices, {
        foreignKey: 'device_id',
        as: 'device'
      });
    }
  }

  DeviceMetrics.init({
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    latency_ms: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    packet_loss: {
      type: DataTypes.FLOAT, // %
      defaultValue: 0
    },
    status: {
      type: DataTypes.STRING, // up / down
      allowNull: false
    },
    client_id: {
      type: DataTypes.INTEGER, // clients in local network
      defaultValue: 0
    },
    checked_at: {
      type: DataTypes.DATE,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'DeviceMetrics',
    tableName: 'DeviceMetrics',
    timestamps: true,
    indexes: [
      { fields: ['device_id'] },
      { fields: ['checked_at'] },
      { fields: ['device_id', 'checked_at'] }, // สำคัญสุด
      { fields: ['status'] }
    ]
  });

  return DeviceMetrics;
};