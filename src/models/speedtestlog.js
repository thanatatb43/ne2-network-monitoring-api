const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class SpeedTestLog extends Model {
    static associate(models) {
      SpeedTestLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  SpeedTestLog.init({
    ip_address: {
      type: DataTypes.STRING,
      allowNull: false
    },
    download_speed: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Speed in Mbps'
    },
    upload_speed: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Speed in Mbps'
    },
    latency: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Latency in ms'
    },
    computer_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mac_address: {
      type: DataTypes.STRING,
      allowNull: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'SpeedTestLog',
    tableName: 'SpeedTestLogs',
    timestamps: false // We use our own timestamp field
  });

  return SpeedTestLog;
};
