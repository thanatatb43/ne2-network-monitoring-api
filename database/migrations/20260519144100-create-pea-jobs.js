'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create PeaJobs table
    await queryInterface.createTable('PeaJobs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      pea_site_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'PeaSites',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      job_name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      job_description: {
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

    await queryInterface.addIndex('PeaJobs', ['pea_site_id']);

    // 2. Add pea_job_id to SiteBudgetTransactions
    await queryInterface.addColumn('SiteBudgetTransactions', 'pea_job_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // true so existing records don't fail, though it's empty now
      references: {
        model: 'PeaJobs',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addIndex('SiteBudgetTransactions', ['pea_job_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('SiteBudgetTransactions', 'pea_job_id');
    await queryInterface.dropTable('PeaJobs');
  }
};
