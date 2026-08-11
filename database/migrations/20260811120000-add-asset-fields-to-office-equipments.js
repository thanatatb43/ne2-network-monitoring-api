'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('OfficeEquipments', 'serial_number', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipments', 'asset_number', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipments', 'asset_owner', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipments', 'asset_owner_emp_id', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipments', 'photos', {
      type: Sequelize.JSON,
      allowNull: true
    });
    await queryInterface.addColumn('OfficeEquipments', 'storage_photo', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('OfficeEquipments', 'serial_number');
    await queryInterface.removeColumn('OfficeEquipments', 'asset_number');
    await queryInterface.removeColumn('OfficeEquipments', 'asset_owner');
    await queryInterface.removeColumn('OfficeEquipments', 'asset_owner_emp_id');
    await queryInterface.removeColumn('OfficeEquipments', 'photos');
    await queryInterface.removeColumn('OfficeEquipments', 'storage_photo');
  }
};
