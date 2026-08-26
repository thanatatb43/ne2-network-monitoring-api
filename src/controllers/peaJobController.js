const fs = require('fs');
const path = require('path');
const { PeaJob, PeaSite, SiteBudgetTransaction, BudgetTransaction, OfficeEquipment, PeaJobEquipment, PeaJobProblemEquipment, PeaJobAuditLog, PeaJobAssignee, User } = require('../models');
const { notifyJobOpened, notifyJobCompleted, notifyJobCancelled } = require('../services/notificationService');

const equipmentInclude = { model: OfficeEquipment, as: 'equipment', attributes: ['id', 'name', 'asset_number', 'status'], through: { attributes: [] } };
const problemEquipmentInclude = { model: OfficeEquipment, as: 'problem_equipment', attributes: ['id', 'name', 'asset_number', 'status'], through: { attributes: [] } };

// linked_user resolves fresh on every query (matched against Users.username by
// assignee_emp_id) - an assignee entered before that person ever logged in
// automatically shows their real account the moment it exists, no backfill needed.
const assigneesInclude = {
  model: PeaJobAssignee,
  as: 'assignees',
  include: [
    { model: User, as: 'linked_user', attributes: ['id', 'username', 'first_name', 'last_name'] }
  ]
};

const JOB_INCLUDES = [
  { model: PeaSite, as: 'pea_site' },
  { model: SiteBudgetTransaction, as: 'transactions' },
  equipmentInclude,
  problemEquipmentInclude,
  assigneesInclude
];

/**
 * Helper to log PEA job workflow actions for auditing (mirrors
 * officeEquipmentController's logAudit pattern).
 */
const logJobAudit = async (req, action, job, data) => {
  try {
    await PeaJobAuditLog.create({
      pea_job_id: job ? job.id : null,
      action,
      job_name: job ? job.job_name : (data ? data.job_name : null),
      data: data || null,
      user_id: req.user ? req.user.id : null,
      user_name: req.user ? req.user.name || req.user.username : 'Unknown'
    });
  } catch (error) {
    console.error('Job audit logging failed:', error);
  }
};

// Get all jobs, paginated. Optionally filtered by pea_site_id - applied server-side
// BEFORE pagination, so filtered results are always complete (a client-side filter
// on top of a paginated fetch would miss matches sitting on pages not yet loaded).
const getAllJobs = async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { pea_site_id, search, status, job_type, priority } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 20, 1);
    const offset = (page - 1) * limit;

    const where = {};
    if (pea_site_id) where.pea_site_id = pea_site_id;
    if (status) where.status = status;
    if (job_type) where.job_type = job_type;
    if (priority) where.priority = priority;
    if (search) {
      where[Op.or] = ['job_name', 'job_description']
        .map(field => ({ [field]: { [Op.substring]: search } }));
    }

    const { count, rows } = await PeaJob.findAndCountAll({
      where,
      include: JOB_INCLUDES,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      distinct: true // avoid inflated count from the hasMany/belongsToMany joins above
    });

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create job and insert budget transactions
const createJob = async (req, res, next) => {
  try {
    const {
      pea_site_id, job_name, job_description, budget_transaction_ids, equipment_ids,
      job_type, priority, department, requester_name, requester_emp_id, requester_contact,
      notification_doc_no, problem_equipment_ids
    } = req.body;

    if (!pea_site_id || !job_name) {
      return res.status(400).json({ success: false, message: 'pea_site_id and job_name are required' });
    }

    // Validate equipment_ids up front (before creating anything) so a bad ID doesn't
    // leave a job created with only some of what was requested.
    let equipmentToLink = [];
    if (equipment_ids && Array.isArray(equipment_ids) && equipment_ids.length > 0) {
      equipmentToLink = await OfficeEquipment.findAll({ where: { id: equipment_ids } });
      if (equipmentToLink.length !== equipment_ids.length) {
        return res.status(404).json({ success: false, message: 'One or more equipment IDs were not found' });
      }
    }

    let problemEquipmentToLink = [];
    if (problem_equipment_ids && Array.isArray(problem_equipment_ids) && problem_equipment_ids.length > 0) {
      problemEquipmentToLink = await OfficeEquipment.findAll({ where: { id: problem_equipment_ids } });
      if (problemEquipmentToLink.length !== problem_equipment_ids.length) {
        return res.status(404).json({ success: false, message: 'One or more problem_equipment_ids were not found' });
      }
    }

    // Check for duplicate job (same site and name)
    const existingJob = await PeaJob.findOne({
      where: { pea_site_id, job_name }
    });

    if (existingJob) {
      return res.status(400).json({ 
        success: false, 
        message: `A job with name '${job_name}' already exists for this PEA site.` 
      });
    }

    let selectedTransactions = [];
    // 1. If budget_transaction_ids is provided, fetch and validate them FIRST
    if (budget_transaction_ids && Array.isArray(budget_transaction_ids) && budget_transaction_ids.length > 0) {
      selectedTransactions = await BudgetTransaction.findAll({
        where: { id: budget_transaction_ids }
      });

      for (const t of selectedTransactions) {
        // Prepare exact match data (excluding IDs and CRUD dates)
        const matchData = {
          pea_site_id: pea_site_id,
          cost_center: t.cost_center,
          cost_center_name: t.cost_center_name,
          clearing_account: t.clearing_account,
          clearing_account_name: t.clearing_account_name,
          username: t.username,
          document_date: t.getDataValue('document_date'), // Must use raw value because getter formats it
          posting_date: t.getDataValue('posting_date'),
          reference_doc_no: t.reference_doc_no,
          value_co_curr: t.value_co_curr,
          description: t.description,
          year: t.year
        };

        // Check if exact duplicate exists for this site
        const exists = await SiteBudgetTransaction.findOne({ where: matchData });

        if (exists) {
          return res.status(400).json({
            success: false,
            message: `Cannot create job. A transaction with Ref Doc No '${t.reference_doc_no}' or value '${t.value_co_curr}' is already linked to this PEA site.`,
            duplicate_transaction: {
              reference_doc_no: t.reference_doc_no,
              value_co_curr: t.value_co_curr,
              description: t.description
            }
          });
        }
      }
    }

    // 2. If validation passed, create the job
    const newJob = await PeaJob.create({
      pea_site_id, job_name, job_description,
      job_type: job_type || null,
      priority: priority || undefined, // let the model default ('ปกติ') apply if omitted
      department: department || null,
      requester_name: requester_name || null,
      requester_emp_id: requester_emp_id || null,
      requester_contact: requester_contact || null,
      notification_doc_no: notification_doc_no || null
    });

    let insertedCount = 0;
    // 3. Insert all validated transactions
    for (const t of selectedTransactions) {
      const matchData = {
        pea_site_id: pea_site_id,
        pea_job_id: newJob.id,
        cost_center: t.cost_center,
        cost_center_name: t.cost_center_name,
        clearing_account: t.clearing_account,
        clearing_account_name: t.clearing_account_name,
        username: t.username,
        document_date: t.getDataValue('document_date'),
        posting_date: t.getDataValue('posting_date'),
        reference_doc_no: t.reference_doc_no,
        value_co_curr: t.value_co_curr,
        description: t.description,
        year: t.year
      };

      await SiteBudgetTransaction.create(matchData);
      insertedCount++;
    }

    // 4. Link any requested equipment (many-to-many)
    if (equipmentToLink.length > 0) {
      await PeaJobEquipment.bulkCreate(
        equipmentToLink.map(eq => ({ pea_job_id: newJob.id, equipment_id: eq.id }))
      );
    }

    // 5. Link any reported problem equipment (many-to-many, separate table)
    if (problemEquipmentToLink.length > 0) {
      await PeaJobProblemEquipment.bulkCreate(
        problemEquipmentToLink.map(eq => ({ pea_job_id: newJob.id, equipment_id: eq.id }))
      );
    }

    await logJobAudit(req, 'OPEN', newJob, {
      job_type: newJob.job_type,
      priority: newJob.priority,
      requester_name: newJob.requester_name
    });

    // Fire-and-forget: don't let a slow/unreachable Teams webhook delay the response
    notifyJobOpened(newJob);

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: newJob,
      transactions_inserted: insertedCount,
      equipment_linked: equipmentToLink.length,
      problem_equipment_linked: problemEquipmentToLink.length
    });

  } catch (error) {
    next(error);
  }
};

// Edit job - the "เปิดงาน" stage fields only for regular admin roles. Progress/
// completion/cancellation fields normally go through their own dedicated endpoints
// below, each with its own status-transition rule (required fields, allowed
// from-status, notifications, etc.) - those rules are bypassed by a direct field
// edit, which is exactly why the full field set is restricted to super_admin only,
// as an admin correction/override tool (e.g. fixing a typo after the fact, or
// correcting the site a job was logged against).
const EDITABLE_OPEN_FIELDS = [
  'job_name', 'job_description', 'job_type', 'priority', 'department',
  'requester_name', 'requester_emp_id', 'requester_contact', 'notification_doc_no'
];

const SUPER_ADMIN_EDITABLE_FIELDS = [
  ...EDITABLE_OPEN_FIELDS,
  'pea_site_id', 'status', 'progress_notes', 'work_order_no',
  'closing_notes', 'cancelled_reason', 'notification_doc_file', 'completion_report_file'
];

const updateJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const isSuperAdmin = req.user && req.user.role === 'super_admin';
    const editableFields = isSuperAdmin ? SUPER_ADMIN_EDITABLE_FIELDS : EDITABLE_OPEN_FIELDS;

    const changes = {};
    for (const field of editableFields) {
      if (req.body[field] !== undefined) {
        changes[field] = req.body[field];
        job[field] = req.body[field];
      }
    }

    await job.save();

    if (Object.keys(changes).length > 0) {
      await logJobAudit(req, 'UPDATE', job, changes);
    }

    res.status(200).json({ success: true, message: 'Job updated successfully', data: job });
  } catch (error) {
    next(error);
  }
};

// Soft delete job
const deleteJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    await logJobAudit(req, 'DELETE', job);

    await job.destroy();

    res.status(200).json({ success: true, message: 'Job deleted successfully (soft delete)' });
  } catch (error) {
    next(error);
  }
};

// Add transactions directly to a PeaSite and optionally a PeaJob
const addTransactionsToSite = async (req, res, next) => {
  try {
    const { pea_site_id, pea_job_id, budget_transaction_ids } = req.body;

    if (!pea_site_id) {
      return res.status(400).json({ success: false, message: 'pea_site_id is required' });
    }

    if (!budget_transaction_ids || !Array.isArray(budget_transaction_ids) || budget_transaction_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'budget_transaction_ids (non-empty array) is required' });
    }

    // 1. If pea_job_id is provided, verify the job exists and belongs to the site
    if (pea_job_id) {
      const job = await PeaJob.findByPk(pea_job_id);
      if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found' });
      }
      if (job.pea_site_id !== parseInt(pea_site_id)) {
        return res.status(400).json({ success: false, message: 'The specified job does not belong to this PEA site' });
      }
    }

    // 2. Fetch and validate transactions for duplicates
    const selectedTransactions = await BudgetTransaction.findAll({
      where: { id: budget_transaction_ids }
    });

    if (selectedTransactions.length === 0) {
      return res.status(404).json({ success: false, message: 'No valid budget transactions found for the provided IDs' });
    }

    for (const t of selectedTransactions) {
      const matchData = {
        pea_site_id: pea_site_id,
        cost_center: t.cost_center,
        cost_center_name: t.cost_center_name,
        clearing_account: t.clearing_account,
        clearing_account_name: t.clearing_account_name,
        username: t.username,
        document_date: t.getDataValue('document_date'),
        posting_date: t.getDataValue('posting_date'),
        reference_doc_no: t.reference_doc_no,
        value_co_curr: t.value_co_curr,
        description: t.description,
        year: t.year
      };

      const exists = await SiteBudgetTransaction.findOne({ where: matchData });

      if (exists) {
        return res.status(400).json({
          success: false,
          message: `A transaction with Ref Doc No '${t.reference_doc_no}' or value '${t.value_co_curr}' is already linked to this PEA site.`,
          duplicate_transaction: {
            reference_doc_no: t.reference_doc_no,
            value_co_curr: t.value_co_curr
          }
        });
      }
    }

    // 3. Insert transactions
    const insertedTransactions = [];
    for (const t of selectedTransactions) {
      const matchData = {
        pea_site_id: pea_site_id,
        pea_job_id: pea_job_id || null, // Optional job link
        cost_center: t.cost_center,
        cost_center_name: t.cost_center_name,
        clearing_account: t.clearing_account,
        clearing_account_name: t.clearing_account_name,
        username: t.username,
        document_date: t.getDataValue('document_date'),
        posting_date: t.getDataValue('posting_date'),
        reference_doc_no: t.reference_doc_no,
        value_co_curr: t.value_co_curr,
        description: t.description,
        year: t.year
      };

      const newTx = await SiteBudgetTransaction.create(matchData);
      insertedTransactions.push(newTx);
    }

    res.status(201).json({
      success: true,
      message: 'Transactions added successfully to the PEA site',
      data: insertedTransactions
    });

  } catch (error) {
    next(error);
  }
};

// Get all SiteBudgetTransactions by pea_site_id
const getTransactionsBySite = async (req, res, next) => {
  try {
    const { pea_site_id } = req.params;

    const transactions = await SiteBudgetTransaction.findAll({
      where: { pea_site_id },
      include: [
        { model: PeaJob, as: 'pea_job', attributes: ['id', 'job_name'] }
      ]
    });

    res.status(200).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

// Get a single job by id
const getJobById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const job = await PeaJob.findByPk(id, { include: JOB_INCLUDES });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    res.status(200).json({
      success: true,
      data: job
    });
  } catch (error) {
    next(error);
  }
};

// Link one or more OfficeEquipment items to a job (many-to-many - the same
// equipment can be linked to multiple jobs over its lifetime, e.g. reused
// across different jobs at different times).
const addEquipmentToJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { equipment_ids } = req.body;

    if (!equipment_ids || !Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'equipment_ids (non-empty array) is required' });
    }

    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const equipmentList = await OfficeEquipment.findAll({ where: { id: equipment_ids } });
    if (equipmentList.length !== equipment_ids.length) {
      return res.status(404).json({ success: false, message: 'One or more equipment IDs were not found' });
    }

    const existingLinks = await PeaJobEquipment.findAll({
      where: { pea_job_id: id, equipment_id: equipment_ids }
    });
    const alreadyLinkedIds = new Set(existingLinks.map(l => l.equipment_id));

    const toCreate = equipment_ids
      .filter(eqId => !alreadyLinkedIds.has(eqId))
      .map(eqId => ({ pea_job_id: id, equipment_id: eqId }));

    const created = await PeaJobEquipment.bulkCreate(toCreate);

    res.status(201).json({
      success: true,
      message: `Linked ${created.length} equipment item(s) to the job`,
      already_linked: [...alreadyLinkedIds],
      data: created
    });
  } catch (error) {
    next(error);
  }
};

// Unlink one piece of equipment from a job
const removeEquipmentFromJob = async (req, res, next) => {
  try {
    const { id, equipment_id } = req.params;

    const deleted = await PeaJobEquipment.destroy({
      where: { pea_job_id: id, equipment_id }
    });

    if (deleted === 0) {
      return res.status(404).json({ success: false, message: 'This equipment is not linked to this job' });
    }

    res.status(200).json({ success: true, message: 'Equipment unlinked from job successfully' });
  } catch (error) {
    next(error);
  }
};

// Same as addEquipmentToJob, but for "problem equipment" (reported faulty at open
// time) via the separate PeaJobProblemEquipments table.
const addProblemEquipmentToJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { equipment_ids } = req.body;

    if (!equipment_ids || !Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'equipment_ids (non-empty array) is required' });
    }

    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const equipmentList = await OfficeEquipment.findAll({ where: { id: equipment_ids } });
    if (equipmentList.length !== equipment_ids.length) {
      return res.status(404).json({ success: false, message: 'One or more equipment IDs were not found' });
    }

    const existingLinks = await PeaJobProblemEquipment.findAll({
      where: { pea_job_id: id, equipment_id: equipment_ids }
    });
    const alreadyLinkedIds = new Set(existingLinks.map(l => l.equipment_id));

    const toCreate = equipment_ids
      .filter(eqId => !alreadyLinkedIds.has(eqId))
      .map(eqId => ({ pea_job_id: id, equipment_id: eqId }));

    const created = await PeaJobProblemEquipment.bulkCreate(toCreate);

    res.status(201).json({
      success: true,
      message: `Linked ${created.length} problem equipment item(s) to the job`,
      already_linked: [...alreadyLinkedIds],
      data: created
    });
  } catch (error) {
    next(error);
  }
};

const removeProblemEquipmentFromJob = async (req, res, next) => {
  try {
    const { id, equipment_id } = req.params;

    const deleted = await PeaJobProblemEquipment.destroy({
      where: { pea_job_id: id, equipment_id }
    });

    if (deleted === 0) {
      return res.status(404).json({ success: false, message: 'This equipment is not linked to this job as problem equipment' });
    }

    res.status(200).json({ success: true, message: 'Problem equipment unlinked from job successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * "ระหว่างดำเนินการ" stage: record who's working the ticket and progress notes.
 * Only allowed from "เปิดงาน" - transitions the job to "ระหว่างดำเนินการ".
 */
const updateJobProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignees, progress_notes, work_order_no } = req.body;

    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.status !== 'เปิดงาน') {
      return res.status(400).json({
        success: false,
        message: `Cannot start progress: job status is "${job.status}", expected "เปิดงาน"`
      });
    }

    await job.update({
      progress_notes: progress_notes !== undefined ? progress_notes : job.progress_notes,
      work_order_no: work_order_no || job.work_order_no,
      status: 'ระหว่างดำเนินการ'
    });

    // Replace the assignee list wholesale with what's sent (this endpoint sets the
    // full current state, same as the rest of its fields).
    if (assignees !== undefined) {
      if (!Array.isArray(assignees)) {
        return res.status(400).json({ success: false, message: 'assignees must be an array of { name, emp_id }' });
      }
      await PeaJobAssignee.destroy({ where: { pea_job_id: id } });
      if (assignees.length > 0) {
        await PeaJobAssignee.bulkCreate(
          assignees.map(a => ({ pea_job_id: id, assignee_name: a.name || null, assignee_emp_id: a.emp_id || null }))
        );
      }
    }

    await logJobAudit(req, 'PROGRESS', job, { assignees, work_order_no: job.work_order_no });

    const updatedJob = await PeaJob.findByPk(id, { include: JOB_INCLUDES });

    res.status(200).json({ success: true, message: 'Job progress updated', data: updatedJob });
  } catch (error) {
    next(error);
  }
};

/**
 * "เสร็จงาน" stage: closing_notes is required. Only allowed from "ระหว่างดำเนินการ" -
 * transitions the job to "เสร็จงาน". Equipment used / transaction numbers are attached
 * via the existing /:id/equipment and /transactions endpoints, not here.
 */
const completeJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { closing_notes } = req.body;
    const file = req.file; // "รายงานหลังเสร็จงาน" - optional, via multer on this route

    if (!closing_notes) {
      if (file) deleteUploadedJobFile(`/uploads/pea-jobs/${file.filename}`);
      return res.status(400).json({ success: false, message: 'closing_notes is required' });
    }

    const job = await PeaJob.findByPk(id);
    if (!job) {
      if (file) deleteUploadedJobFile(`/uploads/pea-jobs/${file.filename}`);
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.status !== 'ระหว่างดำเนินการ') {
      if (file) deleteUploadedJobFile(`/uploads/pea-jobs/${file.filename}`);
      return res.status(400).json({
        success: false,
        message: `Cannot complete: job status is "${job.status}", expected "ระหว่างดำเนินการ"`
      });
    }

    const oldReportFile = job.completion_report_file;
    const newReportFile = file ? `/uploads/pea-jobs/${file.filename}` : job.completion_report_file;

    await job.update({ closing_notes, status: 'เสร็จงาน', completion_report_file: newReportFile });
    if (file) deleteUploadedJobFile(oldReportFile);

    await logJobAudit(req, 'COMPLETE', job, { closing_notes, completion_report_file: newReportFile });

    notifyJobCompleted(job);

    res.status(200).json({ success: true, message: 'Job marked as completed', data: job });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel a job - only from "เปิดงาน" or "ระหว่างดำเนินการ" (not from a job that's
 * already "เสร็จงาน" or already "ยกเลิก").
 */
const cancelJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cancelled_reason } = req.body;

    if (!cancelled_reason) {
      return res.status(400).json({ success: false, message: 'cancelled_reason is required' });
    }

    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (!['เปิดงาน', 'ระหว่างดำเนินการ'].includes(job.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel: job status is already "${job.status}"`
      });
    }

    await job.update({ cancelled_reason, status: 'ยกเลิก' });

    await logJobAudit(req, 'CANCEL', job, { cancelled_reason });

    notifyJobCancelled(job);

    res.status(200).json({ success: true, message: 'Job cancelled', data: job });
  } catch (error) {
    next(error);
  }
};

// Full audit/change history for a job, newest first
const getJobHistory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const logs = await PeaJobAuditLog.findAll({
      where: { pea_job_id: id },
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    next(error);
  }
};

/** Delete an uploaded file given its public path, non-fatal if it's already gone. */
const deleteUploadedJobFile = (publicPath) => {
  if (!publicPath) return;
  const filePath = path.join(__dirname, '../../', publicPath);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`[deleteUploadedJobFile] Could not remove file ${filePath}:`, err.message);
    }
  }
};

// Upload the "หนังสือแจ้ง" attachment for a job (replaces any previous one)
const uploadNotificationDoc = async (req, res, next) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const job = await PeaJob.findByPk(id);
    if (!job) {
      deleteUploadedJobFile(`/uploads/pea-jobs/${file.filename}`);
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const oldFile = job.notification_doc_file;
    const newPath = `/uploads/pea-jobs/${file.filename}`;
    await job.update({ notification_doc_file: newPath });
    deleteUploadedJobFile(oldFile);

    await logJobAudit(req, 'UPDATE', job, { notification_doc_file: newPath });

    res.status(200).json({ success: true, message: 'Notification document uploaded successfully', data: { notification_doc_file: newPath } });
  } catch (error) {
    next(error);
  }
};

// Upload up to 5 "after" photos for a job (adds to whatever's already there)
const MAX_JOB_AFTER_PHOTOS = 5;
const uploadJobAfterPhotos = async (req, res, next) => {
  try {
    const { id } = req.params;
    const files = req.files || [];

    const job = await PeaJob.findByPk(id);
    if (!job) {
      files.forEach(f => deleteUploadedJobFile(`/uploads/pea-jobs/${f.filename}`));
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const existingPhotos = job.after_photos || [];
    if (existingPhotos.length + files.length > MAX_JOB_AFTER_PHOTOS) {
      files.forEach(f => deleteUploadedJobFile(`/uploads/pea-jobs/${f.filename}`));
      return res.status(400).json({
        success: false,
        message: `Cannot add ${files.length} photo(s): would exceed the ${MAX_JOB_AFTER_PHOTOS}-photo limit (currently has ${existingPhotos.length})`
      });
    }

    const newPaths = files.map(f => `/uploads/pea-jobs/${f.filename}`);
    const photos = [...existingPhotos, ...newPaths];
    await job.update({ after_photos: photos });

    await logJobAudit(req, 'UPDATE', job, { photos_added: newPaths });

    res.status(200).json({ success: true, message: 'Photos uploaded successfully', data: { after_photos: photos } });
  } catch (error) {
    next(error);
  }
};

// Get PEA sites lookup (id and pea_name only)
const getPeaSitesLookup = async (req, res, next) => {
  try {
    const sites = await PeaSite.findAll({
      attributes: ['id', 'pea_name'],
      order: [['id', 'ASC']]
    });

    res.status(200).json({
      success: true,
      data: sites
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllJobs,
  createJob,
  updateJob,
  deleteJob,
  addTransactionsToSite,
  getTransactionsBySite,
  getJobById,
  addEquipmentToJob,
  removeEquipmentFromJob,
  addProblemEquipmentToJob,
  removeProblemEquipmentFromJob,
  updateJobProgress,
  completeJob,
  cancelJob,
  getJobHistory,
  uploadNotificationDoc,
  uploadJobAfterPhotos,
  getPeaSitesLookup
};
