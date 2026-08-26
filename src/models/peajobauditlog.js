'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaJobAuditLog extends Model {
    static associate(models) {
      // define association here if needed in the future
    }
  }

  PeaJobAuditLog.init({
    pea_job_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false
    },
    job_name: {
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
    modelName: 'PeaJobAuditLog',
    tableName: 'PeaJobAuditLogs',
    timestamps: true
  });

  return PeaJobAuditLog;
};
