'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('OfficeEquipmentLoans', 'borrower_name', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipmentLoans', 'borrower_emp_id', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipmentLoans', 'borrower_contact', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('OfficeEquipmentLoans', 'borrower_name');
    await queryInterface.removeColumn('OfficeEquipmentLoans', 'borrower_emp_id');
    await queryInterface.removeColumn('OfficeEquipmentLoans', 'borrower_contact');
  }
};
