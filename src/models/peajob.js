'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PeaJob extends Model {
    static associate(models) {
      PeaJob.belongsTo(models.PeaSite, {
        foreignKey: 'pea_site_id',
        as: 'pea_site'
      });

      if (models.SiteBudgetTransaction) {
        PeaJob.hasMany(models.SiteBudgetTransaction, {
          foreignKey: 'pea_job_id',
          as: 'transactions'
        });
      }

      if (models.PeaSite) {
        models.PeaSite.hasMany(PeaJob, {
          foreignKey: 'pea_site_id',
          as: 'jobs'
        });
      }

      if (models.OfficeEquipment && models.PeaJobEquipment) {
        PeaJob.belongsToMany(models.OfficeEquipment, {
          through: models.PeaJobEquipment,
          foreignKey: 'pea_job_id',
          otherKey: 'equipment_id',
          as: 'equipment'
        });
      }

      // Equipment reported as faulty when the ticket was opened - separate from
      // 'equipment' above (which is what was actually used to resolve it).
      if (models.OfficeEquipment && models.PeaJobProblemEquipment) {
        PeaJob.belongsToMany(models.OfficeEquipment, {
          through: models.PeaJobProblemEquipment,
          foreignKey: 'pea_job_id',
          otherKey: 'equipment_id',
          as: 'problem_equipment'
        });
      }

      if (models.PeaJobAssignee) {
        PeaJob.hasMany(models.PeaJobAssignee, {
          foreignKey: 'pea_job_id',
          as: 'assignees'
        });
      }
    }
  }

  PeaJob.init({
    pea_site_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    job_name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    job_description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // แจ้งซ่อม / ขออุปกรณ์ใหม่ / ขอเปลี่ยนอุปกรณ์ / แจ้งระบบใช้งานไม่ได้ - free text, not enforced as enum
    job_type: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // เปิดงาน -> ระหว่างดำเนินการ -> เสร็จงาน, or ยกเลิก from either of the first two
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'เปิดงาน'
    },
    // เร่งด่วน / ปกติ
    priority: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ปกติ'
    },
    department: {
      type: DataTypes.STRING,
      allowNull: true
    },
    requester_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    requester_emp_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    requester_contact: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notification_doc_no: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notification_doc_file: {
      type: DataTypes.STRING,
      allowNull: true
    },
    progress_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    work_order_no: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Array of up to 5 uploaded photo paths, same TEXT+JSON pattern as
    // OfficeEquipment.photos (this Sequelize/mysql2 setup doesn't auto-parse
    // MySQL's native JSON type back into a JS array).
    after_photos: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const value = this.getDataValue('after_photos');
        return value ? JSON.parse(value) : [];
      },
      set(value) {
        this.setDataValue('after_photos', value ? JSON.stringify(value) : null);
      }
    },
    closing_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // "รายงานหลังเสร็จงาน" - a single report document attached when completing the job
    completion_report_file: {
      type: DataTypes.STRING,
      allowNull: true
    },
    cancelled_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'PeaJob',
    tableName: 'PeaJobs',
    timestamps: true,
    paranoid: true
  });

  return PeaJob;
};
