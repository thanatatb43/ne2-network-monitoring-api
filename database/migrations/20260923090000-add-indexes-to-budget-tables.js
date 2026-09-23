'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // BudgetTransactions previously had only its PRIMARY key - every filter used by the
    // new dashboard/transactions/aggregates endpoints (year, cost_center, posting_date,
    // username) was a full table scan. Table is small today (~6k rows) but the new
    // endpoints are meant to scale with future imports.
    await queryInterface.addIndex('BudgetTransactions', ['year'], { name: 'budget_transactions_year' });
    await queryInterface.addIndex('BudgetTransactions', ['cost_center'], { name: 'budget_transactions_cost_center' });
    await queryInterface.addIndex('BudgetTransactions', ['posting_date'], { name: 'budget_transactions_posting_date' });
    await queryInterface.addIndex('BudgetTransactions', ['username'], { name: 'budget_transactions_username' });
    await queryInterface.addIndex('BudgetTransactions', ['year', 'cost_center'], { name: 'budget_transactions_year_cost_center' });

    await queryInterface.addIndex('Budgets', ['account_code', 'year'], { name: 'budgets_account_code_year' });
    await queryInterface.addIndex('Budgets', ['year'], { name: 'budgets_year' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('BudgetTransactions', 'budget_transactions_year');
    await queryInterface.removeIndex('BudgetTransactions', 'budget_transactions_cost_center');
    await queryInterface.removeIndex('BudgetTransactions', 'budget_transactions_posting_date');
    await queryInterface.removeIndex('BudgetTransactions', 'budget_transactions_username');
    await queryInterface.removeIndex('BudgetTransactions', 'budget_transactions_year_cost_center');
    await queryInterface.removeIndex('Budgets', 'budgets_account_code_year');
    await queryInterface.removeIndex('Budgets', 'budgets_year');
  }
};
