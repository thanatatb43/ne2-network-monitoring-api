'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('LatencyLogsHourlies', {
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
      avg_latency_ms: {
        type: Sequelize.FLOAT
      },
      min_latency_ms: {
        type: Sequelize.FLOAT
      },
      max_latency_ms: {
        type: Sequelize.FLOAT
      },
      packet_loss: {
        type: Sequelize.FLOAT
      },
      samples: {
        type: Sequelize.INTEGER
      },
      hour: {
        type: Sequelize.DATE,
        allowNull: false
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

    await queryInterface.addConstraint('LatencyLogsHourlies', {
      fields: ['device_id', 'hour'],
      type: 'unique',
      name: 'uniq_device_hour'
    });

  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('LatencyLogsHourlies');
  }
};