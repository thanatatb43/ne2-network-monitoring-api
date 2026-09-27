'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('DowntimeQueryRow', {
  snapshot_token: {
    type: DataTypes.STRING(64), primaryKey: true,
    references: { model: 'DowntimeQuerySnapshots', key: 'token' }, onDelete: 'CASCADE'
  },
  incident_id: { type: DataTypes.INTEGER, primaryKey: true },
  device_id: DataTypes.INTEGER,
  device_name: DataTypes.STRING,
  pea_name: DataTypes.STRING,
  gateway: DataTypes.STRING,
  province: DataTypes.STRING,
  down_ms: DataTypes.BIGINT,
  up_ms: DataTypes.BIGINT,
  end_ms: DataTypes.BIGINT,
  duration_ms: DataTypes.BIGINT,
  status: { type: DataTypes.STRING(16), allowNull: false },
  invalid_start: { type: DataTypes.BOOLEAN, allowNull: false },
  invalid_interval: { type: DataTypes.BOOLEAN, allowNull: false }
}, { tableName: 'DowntimeQueryRows', timestamps: false });
