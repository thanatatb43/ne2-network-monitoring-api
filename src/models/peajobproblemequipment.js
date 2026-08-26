'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaJobProblemEquipment extends Model {
    static associate(models) {
      PeaJobProblemEquipment.belongsTo(models.PeaJob, {
        foreignKey: 'pea_job_id',
        as: 'pea_job'
      });
      PeaJobProblemEquipment.belongsTo(models.OfficeEquipment, {
        foreignKey: 'equipment_id',
        as: 'equipment'
      });
    }
  }

  PeaJobProblemEquipment.init({
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
    modelName: 'PeaJobProblemEquipment',
    tableName: 'PeaJobProblemEquipments',
    timestamps: true
  });

  return PeaJobProblemEquipment;
};
