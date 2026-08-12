'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('OfficeEquipmentLoans', 'due_date', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('OfficeEquipmentLoans', 'due_date', {
      type: Sequelize.DATEONLY,
      allowNull: true
    });
  }
};
