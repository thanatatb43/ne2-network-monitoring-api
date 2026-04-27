'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class NetworkDevices extends Model {
    static associate(models) {
      NetworkDevices.hasOne(models.DeviceMetrics, {
        foreignKey: 'device_id',
        as: 'metrics'
      });
    }
  }

  NetworkDevices.init({
    index: {
      type: DataTypes.INTEGER,
      allowNull: true // Handled by hook
    },
    pea_type: DataTypes.STRING,
    pea_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    province: DataTypes.STRING,

    web: {
      type: DataTypes.STRING
    },
    gateway: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },
    dhcp: {
      type: DataTypes.STRING
      // Note: This field can contain ranges (e.g. "1.1.1.1 - 1.1.1.10"), so strict IP validation is disabled.
    },

    network_id: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },
    subnet: DataTypes.STRING,

    sub_ip1_gateway: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },
    sub_ip1_subnet: DataTypes.STRING,

    sub_ip2_gateway: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },
    sub_ip2_subnet: DataTypes.STRING,

    wan_gateway_mpls: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },
    wan_ip_fgt: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },

    vpn_main: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },
    vpn_backup: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    },

    gateway_backup: {
      type: DataTypes.STRING,
      validate: { isIP: 4 }
    }
  }, {
    sequelize,
    modelName: 'NetworkDevices',
    tableName: 'network_devices',
    timestamps: true,
    paranoid: true, // Enable soft deletes
    indexes: [
      { fields: ['pea_name'] },
      { fields: ['province'] }
    ],
    hooks: {
      beforeCreate: async (device) => {
        if (device.index === undefined || device.index === null) {
          const maxIndex = await sequelize.models.NetworkDevices.max('index') || 0;
          device.index = maxIndex + 1;
        }
      }
    }
  });

  return NetworkDevices;
};