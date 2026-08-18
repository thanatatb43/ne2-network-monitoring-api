'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaJobEquipment extends Model {
    static associate(models) {
      PeaJobEquipment.belongsTo(models.PeaJob, {
        foreignKey: 'pea_job_id',
        as: 'pea_job'
      });
      PeaJobEquipment.belongsTo(models.OfficeEquipment, {
        foreignKey: 'equipment_id',
        as: 'equipment'
      });
    }
  }

  PeaJobEquipment.init({
    pea_job_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    equipment_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'PeaJobEquipment',
    tableName: 'PeaJobEquipments',
    timestamps: true
  });

  return PeaJobEquipment;
};
