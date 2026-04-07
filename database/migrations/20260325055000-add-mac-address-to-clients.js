'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('clients', 'mac_address', {
      type: Sequelize.STRING,
      allowNull: true,
      after: 'ip_address'
    });
    
    await queryInterface.addIndex('clients', ['mac_address'], {
      unique: true,
      name: 'clients_mac_address_unique'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('clients', 'mac_address');
  }
};
