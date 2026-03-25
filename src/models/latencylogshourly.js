'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class LatencyHourly extends Model {
    static associate(models) {
      LatencyHourly.belongsTo(models.NetworkDevices, {
        foreignKey: 'device_id',
        as: 'device'
      });
    }
  }

  LatencyHourly.init({
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    avg_latency_ms: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    min_latency_ms: DataTypes.FLOAT,
    max_latency_ms: DataTypes.FLOAT,
    packet_loss: {
      type: DataTypes.FLOAT, // %
      defaultValue: 0
    },
    samples: {
      type: DataTypes.INTEGER, // จำนวนครั้งที่วัดในชั่วโมงนั้น
      defaultValue: 0
    },
    hour: {
      type: DataTypes.DATE, // เก็บเป็นต้นชั่วโมง เช่น 2026-03-24 14:00:00
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'LatencyHourly',
    tableName: 'LatencyLogsHourlies',
    timestamps: true,
    indexes: [
      { fields: ['device_id'] },
      { fields: ['hour'] },
      {
        unique: true,
        fields: ['device_id', 'hour'] // กันข้อมูลซ้ำ
      }
    ]
  });

  return LatencyHourly;
};