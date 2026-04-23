'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SpeedTestLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      ip_address: {
        type: Sequelize.STRING,
        allowNull: false
      },
      download_speed: {
        type: Sequelize.FLOAT,
        allowNull: true
      },
      upload_speed: {
        type: Sequelize.FLOAT,
        allowNull: true
      },
      latency: {
        type: Sequelize.FLOAT,
        allowNull: true
      },
      computer_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      mac_address: {
        type: Sequelize.STRING,
        allowNull: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      userAgent: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      timestamp: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('SpeedTestLogs');
  }
};
