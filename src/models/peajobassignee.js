'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaJobAssignee extends Model {
    static associate(models) {
      PeaJobAssignee.belongsTo(models.PeaJob, {
        foreignKey: 'pea_job_id',
        as: 'pea_job'
      });

      // Loose match against Users.username (not a real FK - assignee_emp_id is free
      // text entered before that person may have ever logged in). Resolved fresh on
      // every read, so it automatically picks up the real account the moment that
      // operator's User row is provisioned via SSO, with no backfill needed.
      if (models.User) {
        PeaJobAssignee.belongsTo(models.User, {
          foreignKey: 'assignee_emp_id',
          targetKey: 'username',
          as: 'linked_user',
          constraints: false
        });
      }
    }
  }

  PeaJobAssignee.init({
    pea_job_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    assignee_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    assignee_emp_id: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'PeaJobAssignee',
    tableName: 'PeaJobAssignees',
    timestamps: true
  });

  return PeaJobAssignee;
};
