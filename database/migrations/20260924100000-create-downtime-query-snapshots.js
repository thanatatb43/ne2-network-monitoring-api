'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DowntimeQuerySnapshots', {
      token: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      scope: { type: Sequelize.STRING(64), allowNull: false },
      as_of_ms: { type: Sequelize.BIGINT, allowNull: false },
      expires_ms: { type: Sequelize.BIGINT, allowNull: false },
      offline_count: { type: Sequelize.INTEGER, allowNull: true }
    });
    await queryInterface.addIndex('DowntimeQuerySnapshots', ['expires_ms']);
    await queryInterface.createTable('DowntimeQueryRows', {
      snapshot_token: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false,
        references: { model: 'DowntimeQuerySnapshots', key: 'token' }, onDelete: 'CASCADE' },
      incident_id: { type: Sequelize.INTEGER, primaryKey: true, allowNull: false },
      device_id: Sequelize.INTEGER,
      device_name: Sequelize.STRING, pea_name: Sequelize.STRING, gateway: Sequelize.STRING, province: Sequelize.STRING,
      down_ms: Sequelize.BIGINT, up_ms: Sequelize.BIGINT, end_ms: Sequelize.BIGINT, duration_ms: Sequelize.BIGINT,
      status: { type: Sequelize.STRING(16), allowNull: false },
      invalid_start: { type: Sequelize.BOOLEAN, allowNull: false },
      invalid_interval: { type: Sequelize.BOOLEAN, allowNull: false }
    });
    // The composite PK serves snapshot-scoped scans and stable incident-ID traversal.
    // Further indexes must be justified against a deployment query plan.
  },
  async down(queryInterface) {
    await queryInterface.dropTable('DowntimeQueryRows');
    await queryInterface.dropTable('DowntimeQuerySnapshots');
  }
};
