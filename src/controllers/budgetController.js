const { Budget } = require('../models');

/**
 * Get all budget records
 */
const getAllBudgets = async (req, res, next) => {
  try {
    const budgets = await Budget.findAll({
      order: [
        ['account_code', 'ASC'],
        ['year', 'DESC'],
        ['period', 'DESC'],
        ['day', 'DESC']
      ]
    });
    res.status(200).json({
      success: true,
      count: budgets.length,
      data: budgets
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get budget summary for a specific year (latest per account)
 */
const getBudgetSummary = async (req, res, next) => {
  try {
    const { year } = req.params;

    // Fetch all records for the year, sorted by date (newest first)
    const budgets = await Budget.findAll({
      where: { year },
      order: [
        ['account_code', 'ASC'],
        ['year', 'DESC'],
        ['period', 'DESC'],
        ['day', 'DESC'],
        ['month', 'DESC']
      ]
    });

    const summaryMap = new Map();
    let totalAllocated = 0;
    let totalUsed = 0;

    budgets.forEach(b => {
      // Since it's sorted by date DESC, the first one we encounter for each account_code is the latest
      if (!summaryMap.has(b.account_code)) {
        const allocated = parseFloat(b.budget_allocated) || 0;
        const used = parseFloat(b.budget_used) || 0;
        const remaining = allocated - used;
        const percentage = allocated > 0 ? (used / allocated) * 100 : 0;

        summaryMap.set(b.account_code, {
          account_code: b.account_code,
          account_name: b.account_name,
          budget_allocated: allocated,
          budget_used: used,
          year: b.year,
          remaining_budget: parseFloat(remaining.toFixed(2)),
          usage_percentage: parseFloat(percentage.toFixed(2))
        });

        // Add to grand totals
        totalAllocated += allocated;
        totalUsed += used;
      }
    });

    const summaryData = Array.from(summaryMap.values());

    // Add Grand Total row if there is data
    if (summaryData.length > 0) {
      const totalRemaining = totalAllocated - totalUsed;
      const totalPercentage = totalAllocated > 0 ? (totalUsed / totalAllocated) * 100 : 0;

      summaryData.push({
        account_code: `รวมทั้งหมด ${year}`,
        account_name: `รวมทั้งหมด ${year}`,
        budget_allocated: parseFloat(totalAllocated.toFixed(2)),
        budget_used: parseFloat(totalUsed.toFixed(2)),
        year: parseInt(year),
        remaining_budget: parseFloat(totalRemaining.toFixed(2)),
        usage_percentage: parseFloat(totalPercentage.toFixed(2))
      });
    }

    res.status(200).json({
      success: true,
      count: summaryData.length,
      data: summaryData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get distinct values for selectors (filters)
 */
const getBudgetSelectors = async (req, res, next) => {
  try {
    // Get distinct cost center groups
    const ccGroups = await Budget.findAll({ 
      attributes: ['cost_center_group'], 
      group: ['cost_center_group'],
      order: [['cost_center_group', 'ASC']]
    });

    // Get distinct accounts (combining code and name)
    const accounts = await Budget.findAll({ 
      attributes: ['account_code', 'account_name'], 
      group: ['account_code', 'account_name'],
      order: [['account_code', 'ASC']]
    });

    // Get distinct years
    const years = await Budget.findAll({ 
      attributes: ['year'], 
      group: ['year'],
      order: [['year', 'DESC']]
    });

    res.status(200).json({
      success: true,
      data: {
        cost_center_groups: ccGroups.map(item => item.cost_center_group).filter(Boolean),
        account_codes: accounts.map(item => item.account_code).filter(Boolean),
        account_names: accounts.map(item => item.account_name).filter(Boolean),
        accounts_mapped: accounts.map(item => ({
          account_code: item.account_code,
          account_name: item.account_name
        })).filter(item => item.account_code),
        years: years.map(item => item.year).filter(Boolean)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single budget record by ID
 */
const getBudgetById = async (req, res, next) => {
  try {
    const budget = await Budget.findByPk(req.params.id);
    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget record not found'
      });
    }
    res.status(200).json({
      success: true,
      data: budget
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new budget record
 */
const createBudget = async (req, res, next) => {
  try {
    const budget = await Budget.create(req.body);
    res.status(201).json({
      success: true,
      message: 'Budget record created successfully',
      data: budget
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update budget record
 */
const updateBudget = async (req, res, next) => {
  try {
    const budget = await Budget.findByPk(req.params.id);
    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget record not found'
      });
    }
    await budget.update(req.body);
    res.status(200).json({
      success: true,
      message: 'Budget record updated successfully',
      data: budget
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete budget record
 */
const deleteBudget = async (req, res, next) => {
  try {
    const budget = await Budget.findByPk(req.params.id);
    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget record not found'
      });
    }
    await budget.destroy();
    res.status(200).json({
      success: true,
      message: 'Budget record deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllBudgets,
  getBudgetSummary,
  getBudgetSelectors,
  getBudgetById,
  createBudget,
  updateBudget,
  deleteBudget
};
