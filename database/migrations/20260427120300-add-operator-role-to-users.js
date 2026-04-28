'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // In MySQL, we need to redefine the entire column for ENUM changes
    await queryInterface.changeColumn('Users', 'role', {
      type: Sequelize.ENUM('user', 'computer_admin', 'network_admin', 'super_admin', 'manager', 'operator'),
      allowNull: false,
      defaultValue: 'user'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Revert by removing 'operator' from the ENUM
    await queryInterface.changeColumn('Users', 'role', {
      type: Sequelize.ENUM('user', 'computer_admin', 'network_admin', 'super_admin', 'manager'),
      allowNull: false,
      defaultValue: 'user'
    });
  }
};
