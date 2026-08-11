'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OfficeEquipmentLoans', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      equipment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'OfficeEquipments',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      borrowed_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      borrowed_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      returned_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
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

    await queryInterface.addIndex('OfficeEquipmentLoans', ['equipment_id']);
    await queryInterface.addIndex('OfficeEquipmentLoans', ['borrowed_by_user_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('OfficeEquipmentLoans');
  }
};
