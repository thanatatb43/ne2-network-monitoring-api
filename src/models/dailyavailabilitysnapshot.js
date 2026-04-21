'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DailyAvailabilitySnapshot extends Model {
    static associate(models) {
      DailyAvailabilitySnapshot.belongsTo(models.NetworkDevices, {
        foreignKey: 'device_id',
        as: 'device'
      });
    }
  }

  DailyAvailabilitySnapshot.init({
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    uptime_pct: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    avg_latency_ms: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'DailyAvailabilitySnapshot',
    tableName: 'DailyAvailabilitySnapshots',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['device_id', 'date']
      }
    ]
  });

  return DailyAvailabilitySnapshot;
};
