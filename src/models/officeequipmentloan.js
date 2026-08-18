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

        // The single currently-open loan (if any) - lets equipment listings show
        // who has it out right now without a separate lookup.
        models.OfficeEquipment.hasOne(OfficeEquipmentLoan, {
          foreignKey: 'equipment_id',
          as: 'current_loan',
          scope: { returned_at: null }
        });
      }
    }
  }

  OfficeEquipmentLoan.init({
    equipment_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    // The logged-in staff account that processed this borrow/return action
    // (e.g. scanned the QR at the counter) - not necessarily the borrower.
    borrowed_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // Who is actually borrowing the equipment - entered manually, not tied to a
    // Users account/login.
    borrower_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    borrower_emp_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    borrower_contact: {
      type: DataTypes.STRING,
      allowNull: true
    },
    borrowed_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    // Full date+time now (was date-only) so a due time can be set, e.g. "return by 17:00"
    due_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    returned_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Groups loans created in the same borrow action together (e.g. borrowing a
    // laptop + a projector for one event) - every loan gets one, even single-item
    // borrows (a "batch of one"), so grouped-display logic works uniformly.
    batch_id: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'OfficeEquipmentLoan',
    tableName: 'OfficeEquipmentLoans',
    timestamps: true,
    indexes: [
      { fields: ['equipment_id'] },
      { fields: ['borrowed_by_user_id'] },
      { fields: ['batch_id'] }
    ]
  });

  return OfficeEquipmentLoan;
};
