'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Clients', 'main_site_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'network_devices',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Clients', 'main_site_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'network_devices',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  }
};
