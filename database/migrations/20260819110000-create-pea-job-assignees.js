'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PeaJobAssignees', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      pea_job_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      // No user_id FK on purpose: not every assignee has logged in yet (no User row
      // exists for them at assignment time). assignee_emp_id is matched against
      // Users.username dynamically at read-time instead (see PeaJobAssignee model's
      // 'linked_user' association), so a currently-unmatched assignee automatically
      // resolves to the real account the moment that person logs in for the first
      // time - no backfill job needed.
      assignee_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      assignee_emp_id: {
        type: Sequelize.STRING,
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

    await queryInterface.addIndex('PeaJobAssignees', ['pea_job_id']);
    await queryInterface.addIndex('PeaJobAssignees', ['assignee_emp_id']);

    // Carry over any existing single-assignee data before dropping those columns.
    await queryInterface.sequelize.query(`
      INSERT INTO PeaJobAssignees (pea_job_id, assignee_name, assignee_emp_id, createdAt, updatedAt)
      SELECT id, assignee_name, assignee_emp_id, NOW(), NOW()
      FROM PeaJobs
      WHERE assignee_name IS NOT NULL OR assignee_emp_id IS NOT NULL
    `);

    await queryInterface.removeColumn('PeaJobs', 'assignee_name');
    await queryInterface.removeColumn('PeaJobs', 'assignee_emp_id');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('PeaJobs', 'assignee_name', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('PeaJobs', 'assignee_emp_id', { type: Sequelize.STRING, allowNull: true });

    // Best-effort: bring back only the first assignee per job.
    await queryInterface.sequelize.query(`
      UPDATE PeaJobs pj
      JOIN (
        SELECT pea_job_id, MIN(id) AS first_id
        FROM PeaJobAssignees
        GROUP BY pea_job_id
      ) first_a ON first_a.pea_job_id = pj.id
      JOIN PeaJobAssignees a ON a.id = first_a.first_id
      SET pj.assignee_name = a.assignee_name, pj.assignee_emp_id = a.assignee_emp_id
    `);

    await queryInterface.dropTable('PeaJobAssignees');
  }
};
