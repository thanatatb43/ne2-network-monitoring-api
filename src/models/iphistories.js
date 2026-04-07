'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class IpHistories extends Model {
    static associate(models) {
      IpHistories.belongsTo(models.Clients, {
        foreignKey: 'client_id',
        as: 'client'
      });
    }
  }

  IpHistories.init({
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    ip_address: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIP: true }
    },
    first_seen: {
      type: DataTypes.DATE,
      allowNull: false
    },
    last_seen: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'IpHistories',
    tableName: 'IpHistories',
    timestamps: true,
    indexes: [
      { fields: ['client_id'] },
      { fields: ['ip_address'] },
      {
        unique: true,
        fields: ['client_id', 'ip_address'] // กันซ้ำ
      }
    ]
  });

  return IpHistories;
};