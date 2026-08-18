'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaJob extends Model {
    static associate(models) {
      PeaJob.belongsTo(models.PeaSite, {
        foreignKey: 'pea_site_id',
        as: 'pea_site'
      });
      
      if (models.SiteBudgetTransaction) {
        PeaJob.hasMany(models.SiteBudgetTransaction, {
          foreignKey: 'pea_job_id',
          as: 'transactions'
        });
      }
      
      if (models.PeaSite) {
        models.PeaSite.hasMany(PeaJob, {
          foreignKey: 'pea_site_id',
          as: 'jobs'
        });
      }

      if (models.OfficeEquipment && models.PeaJobEquipment) {
        PeaJob.belongsToMany(models.OfficeEquipment, {
          through: models.PeaJobEquipment,
          foreignKey: 'pea_job_id',
          otherKey: 'equipment_id',
          as: 'equipment'
        });
      }
    }
  }

  PeaJob.init({
    pea_site_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    job_name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    job_description: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'PeaJob',
    tableName: 'PeaJobs',
    timestamps: true,
    paranoid: true
  });

  return PeaJob;
};
