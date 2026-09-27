'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('DowntimeQuerySnapshot', {
  token: { type: DataTypes.STRING(64), primaryKey: true },
  scope: { type: DataTypes.STRING(64), allowNull: false },
  as_of_ms: { type: DataTypes.BIGINT, allowNull: false },
  expires_ms: { type: DataTypes.BIGINT, allowNull: false },
  offline_count: { type: DataTypes.INTEGER, allowNull: true }
}, { tableName: 'DowntimeQuerySnapshots', timestamps: false });
