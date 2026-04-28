'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class BudgetTransaction extends Model {
    static associate(models) {
      // define association here
    }
  }
  BudgetTransaction.init({
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
      allowNull: true
    },
    posting_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
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
    modelName: 'BudgetTransaction',
    tableName: 'BudgetTransactions',
    timestamps: true,
    paranoid: true
  });
  return BudgetTransaction;
};
