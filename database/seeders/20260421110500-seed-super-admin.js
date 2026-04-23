'use strict';
const bcrypt = require('bcryptjs');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('P@ss2024###', salt);

    return queryInterface.bulkInsert('Users', [{
      username: '510831',
      password_hash: passwordHash,
      role: 'super_admin',
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Users', { username: '510831' }, {});
  }
};
