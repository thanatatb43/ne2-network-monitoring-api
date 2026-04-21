'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. Clear the table first to handle duplicate device_ids cleanly
      await queryInterface.sequelize.query('DELETE FROM DevicesAvailability', { transaction });

      // 2. Remove AUTO_INCREMENT from 'id' (MySQL requires it to be a key, so we must remove it before dropping PK)
      await queryInterface.changeColumn('DevicesAvailability', 'id', {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: false
      }, { transaction });

      // 3. Drop the existing primary key
      await queryInterface.sequelize.query('ALTER TABLE DevicesAvailability DROP PRIMARY KEY', { transaction });

      // 4. Drop the redundant 'id' column
      await queryInterface.removeColumn('DevicesAvailability', 'id', { transaction });


      // 4. Set 'device_id' as the new primary key
      await queryInterface.changeColumn('DevicesAvailability', 'device_id', {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. Revert device_id to regular column
      await queryInterface.changeColumn('DevicesAvailability', 'device_id', {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: false
      }, { transaction });

      // 2. Add 'id' column back as PK
      await queryInterface.addColumn('DevicesAvailability', 'id', {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
