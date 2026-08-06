'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Budgets', 'period', {
      type: Sequelize.DECIMAL(5, 1),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Budgets', 'period', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  }
};
