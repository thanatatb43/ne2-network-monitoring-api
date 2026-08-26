'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PeaJobs', 'job_type', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'status', { type: Sequelize.STRING, allowNull: false, defaultValue: 'เปิดงาน' });
    await queryInterface.addColumn('PeaJobs', 'priority', { type: Sequelize.STRING, allowNull: false, defaultValue: 'ปกติ' });
    await queryInterface.addColumn('PeaJobs', 'department', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'requester_name', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'requester_emp_id', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'requester_contact', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'notification_doc_no', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'notification_doc_file', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'assignee_name', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'assignee_emp_id', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'progress_notes', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'work_order_no', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'after_photos', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'closing_notes', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'cancelled_reason', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addIndex('PeaJobs', ['status']);
  },

  async down(queryInterface) {
    const columns = [
      'job_type', 'status', 'priority', 'department', 'requester_name', 'requester_emp_id',
      'requester_contact', 'notification_doc_no', 'notification_doc_file', 'assignee_name',
      'assignee_emp_id', 'progress_notes', 'work_order_no', 'after_photos', 'closing_notes',
      'cancelled_reason'
    ];
    for (const col of columns) {
      await queryInterface.removeColumn('PeaJobs', col);
    }
  }
};
