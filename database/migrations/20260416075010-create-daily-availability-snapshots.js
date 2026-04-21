'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DailyAvailabilitySnapshots', {
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
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      uptime_pct: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      avg_latency_ms: {
        type: Sequelize.FLOAT,
        defaultValue: 0
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

    // Add unique index for device_id and date
    await queryInterface.addIndex('DailyAvailabilitySnapshots', ['device_id', 'date'], {
      unique: true,
      name: 'daily_availability_unique_device_date'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('DailyAvailabilitySnapshots');
  }
};
