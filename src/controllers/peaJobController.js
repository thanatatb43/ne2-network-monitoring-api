const { PeaJob, PeaSite, SiteBudgetTransaction, BudgetTransaction, OfficeEquipment, PeaJobEquipment } = require('../models');

const equipmentInclude = { model: OfficeEquipment, as: 'equipment', attributes: ['id', 'name', 'asset_number', 'status'], through: { attributes: [] } };

// Get all jobs, paginated. Optionally filtered by pea_site_id - applied server-side
// BEFORE pagination, so filtered results are always complete (a client-side filter
// on top of a paginated fetch would miss matches sitting on pages not yet loaded).
const getAllJobs = async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { pea_site_id, search } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 20, 1);
    const offset = (page - 1) * limit;

    const where = {};
    if (pea_site_id) where.pea_site_id = pea_site_id;
    if (search) {
      where[Op.or] = ['job_name', 'job_description']
        .map(field => ({ [field]: { [Op.substring]: search } }));
    }

    const { count, rows } = await PeaJob.findAndCountAll({
      where,
      include: [
        { model: PeaSite, as: 'pea_site' },
        { model: SiteBudgetTransaction, as: 'transactions' },
        equipmentInclude
      ],
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
    const { pea_site_id, job_name, job_description, budget_transaction_ids, equipment_ids } = req.body;

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
    const newJob = await PeaJob.create({ pea_site_id, job_name, job_description });

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

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: newJob,
      transactions_inserted: insertedCount,
      equipment_linked: equipmentToLink.length
    });

  } catch (error) {
    next(error);
  }
};

// Edit job (only job_name and job_description)
const updateJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { job_name, job_description } = req.body;

    const job = await PeaJob.findByPk(id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job_name) job.job_name = job_name;
    if (job_description !== undefined) job.job_description = job_description;

    await job.save();

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

    const job = await PeaJob.findByPk(id, {
      include: [
        { model: PeaSite, as: 'pea_site' },
        { model: SiteBudgetTransaction, as: 'transactions' },
        equipmentInclude
      ]
    });

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
  getPeaSitesLookup
};
