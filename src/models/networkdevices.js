'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class NetworkDevices extends Model {
    static associate(models) { }
  }

  NetworkDevices.init({
    index: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    pea_type: DataTypes.STRING,
    pea_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    province: DataTypes.STRING,

    web: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },
    gateway: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },
    dhcp: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },

    network_id: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },
    subnet: DataTypes.STRING,

    sub_ip1_gateway: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },
    sub_ip1_subnet: DataTypes.STRING,

    sub_ip2_gateway: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },
    sub_ip2_subnet: DataTypes.STRING,

    wan_gateway_mpls: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },
    wan_ip_fgt: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    },

    vpn_main: DataTypes.STRING,
    vpn_backup: DataTypes.STRING,

    gateway_backup: {
      type: DataTypes.STRING,
      validate: { isIP: true }
    }
  }, {
    sequelize,
    modelName: 'NetworkDevices',
    tableName: 'network_devices',
    timestamps: true,
    indexes: [
      { fields: ['pea_name'] },
      { fields: ['province'] }
    ]
  });

  return NetworkDevices;
};