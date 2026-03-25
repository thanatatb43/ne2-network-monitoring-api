'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Force the change using raw SQL to bypass any Sequelize changeColumn issues with MySQL
    await queryInterface.sequelize.query('ALTER TABLE Clients MODIFY main_site_id INT NULL;');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TABLE Clients MODIFY main_site_id INT NOT NULL;');
  }
};
