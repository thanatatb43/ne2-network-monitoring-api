// Verify by checking the model directly in a node script.
async function verifyWithModel() {
  const { Budget } = require('./src/models');
  try {
    console.log('--- Verifying with Sequelize Model ---');
    
    const budget = await Budget.create({
      cost_center_group: 'IT',
      account_code: 'IT-001',
      account_name: 'Software Licensing',
      budget_used: 1000.00,
      budget_allocated: 10000.00,
      year: 2026,
      month: 4
    });
    console.log('Create Success:', budget.account_name);

    const found = await Budget.findByPk(budget.id);
    console.log('Read Success:', found.account_code);

    await found.update({ budget_used: 1200.00 });
    console.log('Update Success:', found.budget_used);

    await found.destroy();
    const deleted = await Budget.findByPk(budget.id);
    console.log('Delete Success:', deleted === null);

    console.log('\n--- Model Verification Complete ---');
  } catch (error) {
    console.error('Model Verification Failed:', error);
  } finally {
    process.exit();
  }
}

verifyWithModel();
