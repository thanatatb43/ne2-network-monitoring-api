'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DeviceDowntimes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      device_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'network_devices',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      down_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      up_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      duration_ms: {
        type: Sequelize.BIGINT,
        allowNull: true
      },
      status: {
        type: Sequelize.STRING, // 'down', 'up'
        defaultValue: 'down'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('DeviceDowntimes', ['device_id']);
    await queryInterface.addIndex('DeviceDowntimes', ['down_at']);
    await queryInterface.addIndex('DeviceDowntimes', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('DeviceDowntimes');
  }
};
