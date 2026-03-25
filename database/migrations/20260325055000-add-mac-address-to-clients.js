'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('clients', 'mac_address', {
      type: Sequelize.STRING,
      allowNull: true, // Allow null initially to avoid issues with existing data
      unique: true,
      after: 'ip_address'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('clients', 'mac_address');
  }
};
