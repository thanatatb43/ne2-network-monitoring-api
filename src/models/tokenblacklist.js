const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class TokenBlacklist extends Model {}

  TokenBlacklist.init({
    token: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'TokenBlacklist',
    tableName: 'TokenBlacklists'
  });

  return TokenBlacklist;
};
