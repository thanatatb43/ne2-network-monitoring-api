'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('network_devices', 'pea_site_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'PeaSites',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addIndex('network_devices', ['pea_site_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('network_devices', 'pea_site_id');
  }
};
