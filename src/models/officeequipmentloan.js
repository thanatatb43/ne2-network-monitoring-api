'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OfficeEquipmentLoan extends Model {
    static associate(models) {
      OfficeEquipmentLoan.belongsTo(models.OfficeEquipment, {
        foreignKey: 'equipment_id',
        as: 'equipment'
      });
      OfficeEquipmentLoan.belongsTo(models.User, {
        foreignKey: 'borrowed_by_user_id',
        as: 'borrowed_by'
      });

      if (models.OfficeEquipment) {
        models.OfficeEquipment.hasMany(OfficeEquipmentLoan, {
          foreignKey: 'equipment_id',
          as: 'loans'
        });
      }
    }
  }

  OfficeEquipmentLoan.init({
    equipment_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    borrowed_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    borrowed_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    returned_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'OfficeEquipmentLoan',
    tableName: 'OfficeEquipmentLoans',
    timestamps: true,
    indexes: [
      { fields: ['equipment_id'] },
      { fields: ['borrowed_by_user_id'] }
    ]
  });

  return OfficeEquipmentLoan;
};
