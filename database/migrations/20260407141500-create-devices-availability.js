'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DevicesAvailability', {
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
      daily_ava: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      weekly_ava: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      monthly_ava: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      yearly_ava: {
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

    // Add index for device_id
    await queryInterface.addIndex('DevicesAvailability', ['device_id']);
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('DevicesAvailability');
  }
};
