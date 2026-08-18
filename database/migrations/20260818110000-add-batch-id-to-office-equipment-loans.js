'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('OfficeEquipmentLoans', 'batch_id', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addIndex('OfficeEquipmentLoans', ['batch_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('OfficeEquipmentLoans', 'batch_id');
  }
};
