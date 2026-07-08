'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SiteBudgetTransactions', {
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
      cost_center: {
        type: Sequelize.STRING,
        allowNull: true
      },
      cost_center_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      clearing_account: {
        type: Sequelize.STRING,
        allowNull: true
      },
      clearing_account_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      username: {
        type: Sequelize.STRING,
        allowNull: true
      },
      document_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      posting_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      reference_doc_no: {
        type: Sequelize.STRING,
        allowNull: true
      },
      value_co_curr: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true
      },
      year: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('SiteBudgetTransactions', ['pea_site_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('SiteBudgetTransactions');
  }
};
