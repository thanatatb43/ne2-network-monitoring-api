'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PeaJobEquipments', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      pea_job_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      equipment_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('PeaJobEquipments', ['pea_job_id']);
    await queryInterface.addIndex('PeaJobEquipments', ['equipment_id']);
    await queryInterface.addIndex('PeaJobEquipments', ['pea_job_id', 'equipment_id'], {
      unique: true,
      name: 'pea_job_equipments_job_equipment_unique'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PeaJobEquipments');
  }
};
