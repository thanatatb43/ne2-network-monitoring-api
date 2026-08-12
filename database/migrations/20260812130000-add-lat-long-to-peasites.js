'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PeaSites', 'latitude', {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true
    });
    await queryInterface.addColumn('PeaSites', 'longitude', {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('PeaSites', 'latitude');
    await queryInterface.removeColumn('PeaSites', 'longitude');
  }
};
