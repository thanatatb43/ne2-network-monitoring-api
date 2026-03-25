'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clients', 'status', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'offline'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Clients', 'status');
  }
};
