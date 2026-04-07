'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Force the change using raw SQL to bypass any Sequelize changeColumn issues with MySQL
    await queryInterface.changeColumn('Clients', 'main_site_id', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Clients', 'main_site_id', {
      type: Sequelize.INTEGER,
      allowNull: false
    });
  }
};
