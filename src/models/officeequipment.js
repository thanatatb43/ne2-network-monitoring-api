'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OfficeEquipment extends Model {
    static associate(models) {
      OfficeEquipment.belongsTo(models.PeaSite, {
        foreignKey: 'pea_site_id',
        as: 'pea_site'
      });
      OfficeEquipment.belongsTo(models.User, {
        foreignKey: 'created_by_user_id',
        as: 'created_by'
      });

      if (models.PeaSite) {
        models.PeaSite.hasMany(OfficeEquipment, {
          foreignKey: 'pea_site_id',
          as: 'equipment'
        });
      }
    }
  }

  OfficeEquipment.init({
    name: {
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
      validate: {
        is: /^([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})$/
      }
    },
    department: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pea_site_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    equipment_type: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    contract_no: {
      type: DataTypes.STRING,
      allowNull: true
    },
    contract_start_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    contract_expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull: true
    },
    created_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'OfficeEquipment',
    tableName: 'OfficeEquipments',
    timestamps: true,
    paranoid: true,
    indexes: [
      { fields: ['pea_site_id'] },
      { fields: ['department'] },
      { fields: ['status'] }
    ]
  });

  return OfficeEquipment;
};
