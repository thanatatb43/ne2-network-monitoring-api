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
      defaultValue: 'ใช้งาน'
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
    },
    serial_number: {
      type: DataTypes.STRING,
      allowNull: true
    },
    asset_number: {
      type: DataTypes.STRING,
      allowNull: true
    },
    asset_owner: {
      type: DataTypes.STRING,
      allowNull: true
    },
    asset_owner_emp_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Array of up to 5 uploaded photo paths (e.g. "/uploads/office-equipment/xxx.jpg").
    // Stored as TEXT with manual JSON (de)serialization - MySQL's native JSON type
    // doesn't get auto-parsed back into a JS array by this Sequelize/mysql2 setup
    // (same reason DeviceAuditLog/OfficeEquipmentAuditLog.data does this too).
    photos: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const value = this.getDataValue('photos');
        return value ? JSON.parse(value) : [];
      },
      set(value) {
        this.setDataValue('photos', value ? JSON.stringify(value) : null);
      }
    },
    // Single photo of where the equipment is physically stored
    storage_photo: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Free-text description of where the equipment is physically stored (e.g. "ชั้น 2 ห้องเก็บของ")
    storage_location: {
      type: DataTypes.STRING,
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
