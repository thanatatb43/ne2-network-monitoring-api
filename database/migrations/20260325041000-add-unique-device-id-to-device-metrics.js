'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Truncate existing data to avoid unique constraint violations
    await queryInterface.bulkDelete('DeviceMetrics', null, {});
    
    // Add unique constraint on device_id
    await queryInterface.addIndex('DeviceMetrics', ['device_id'], {
      unique: true,
      name: 'device_id_unique'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('DeviceMetrics', 'device_id_unique');
  }
};
