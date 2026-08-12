'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('OfficeEquipments', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'ใช้งาน'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('OfficeEquipments', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'active'
    });
  }
};
