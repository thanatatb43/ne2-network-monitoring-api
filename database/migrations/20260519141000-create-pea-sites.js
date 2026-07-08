'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PeaSites', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      pea_name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      pea_province: {
        type: Sequelize.STRING,
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

    // Add index for fast searching by province
    await queryInterface.addIndex('PeaSites', ['pea_province']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('PeaSites');
  }
};
