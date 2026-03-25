'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class LatencyLogs extends Model {
    static associate(models) {
      LatencyLogs.belongsTo(models.NetworkDevices, {
        foreignKey: 'device_id',
        as: 'device'
      });
    }
  }

  LatencyLogs.init({
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
    checked_at: {
      type: DataTypes.DATE,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'LatencyLogs',
    tableName: 'LatencyLogsMinutes',
    timestamps: true,
    indexes: [
      { fields: ['device_id'] },
      { fields: ['checked_at'] },
      { fields: ['device_id', 'checked_at'] }
    ]
  });

  return LatencyLogs;
};