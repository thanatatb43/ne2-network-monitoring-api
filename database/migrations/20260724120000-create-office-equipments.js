'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OfficeEquipments', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      ip_address: {
        type: Sequelize.STRING,
        allowNull: true
      },
      mac_address: {
        type: Sequelize.STRING,
        allowNull: true
      },
      department: {
        type: Sequelize.STRING,
        allowNull: true
      },
      pea_site_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'PeaSites',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      equipment_type: {
        type: Sequelize.STRING,
        allowNull: true
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      contract_no: {
        type: Sequelize.STRING,
        allowNull: true
      },
      contract_start_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      contract_expiry_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      vendor: {
        type: Sequelize.STRING,
        allowNull: true
      },
      created_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      deletedAt: {
        allowNull: true,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('OfficeEquipments', ['pea_site_id']);
    await queryInterface.addIndex('OfficeEquipments', ['department']);
    await queryInterface.addIndex('OfficeEquipments', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('OfficeEquipments');
  }
};
