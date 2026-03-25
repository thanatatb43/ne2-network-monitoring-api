'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Clients extends Model {
    static associate(models) {
      Clients.belongsTo(models.NetworkDevices, {
        foreignKey: 'main_site_id',
        as: 'main_site'
      });
    }
  }

  Clients.init({
    client_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ip_address: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: { isIP: true }
    },
    mac_address: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      validate: {
        is: /^(([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})|IP-[\d\.]+)$/
      }
    },
    first_seen: {
      type: DataTypes.DATE,
      allowNull: false
    },
    last_online: {
      type: DataTypes.DATE,
      allowNull: false
    },
    site: {
      type: DataTypes.STRING
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'offline'
    },
    main_site_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Clients',
    tableName: 'Clients',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['ip_address'] }, // กันซ้ำ
      { fields: ['client_name'] },
      { fields: ['main_site_id'] },
      { fields: ['last_online'] }
    ]
  });

  return Clients;
};