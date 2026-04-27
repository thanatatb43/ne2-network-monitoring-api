'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DeviceAuditLog extends Model {
    static associate(models) {
      // define association here
    }
  }

  DeviceAuditLog.init({
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false
    },
    pea_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    data: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const value = this.getDataValue('data');
        return value ? JSON.parse(value) : null;
      },
      set(value) {
        this.setDataValue('data', value ? JSON.stringify(value) : null);
      }
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    user_name: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'DeviceAuditLog',
    tableName: 'DeviceAuditLogs'
  });

  return DeviceAuditLog;
};
