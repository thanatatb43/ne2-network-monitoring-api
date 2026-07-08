'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SiteBudgetTransaction extends Model {
    static associate(models) {
      SiteBudgetTransaction.belongsTo(models.PeaSite, {
        foreignKey: 'pea_site_id',
        as: 'pea_site'
      });
      if (models.PeaJob) {
        SiteBudgetTransaction.belongsTo(models.PeaJob, {
          foreignKey: 'pea_job_id',
          as: 'pea_job'
        });
      }
      
      // Optionally add the reverse association in PeaSite model
      if (models.PeaSite) {
        models.PeaSite.hasMany(SiteBudgetTransaction, {
          foreignKey: 'pea_site_id',
          as: 'transactions'
        });
      }
    }
  }
  
  SiteBudgetTransaction.init({
    pea_site_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    pea_job_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    cost_center: {
      type: DataTypes.STRING,
      allowNull: true
    },
    cost_center_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    clearing_account: {
      type: DataTypes.STRING,
      allowNull: true
    },
    clearing_account_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true
    },
    document_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('document_date');
        if (!rawValue) return null;
        const parts = rawValue.split('-');
        if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
        return rawValue;
      }
    },
    posting_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('posting_date');
        if (!rawValue) return null;
        const parts = rawValue.split('-');
        if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
        return rawValue;
      }
    },
    reference_doc_no: {
      type: DataTypes.STRING,
      allowNull: true
    },
    value_co_curr: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'SiteBudgetTransaction',
    tableName: 'SiteBudgetTransactions',
    timestamps: true
  });
  
  return SiteBudgetTransaction;
};
