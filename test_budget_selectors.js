const { Budget } = require('./src/models');

async function testSelectors() {
  try {
    console.log('--- Testing Budget Selectors ---');

    // Create a dummy record
    const dummyBudget = await Budget.create({
      cost_center_group: 'HQ-Marketing',
      account_code: 'MKT-001',
      account_name: 'Ads Budget',
      budget_used: 100,
      budget_allocated: 500,
      year: 2025,
      month: 1
    });

    const ccGroups = await Budget.findAll({ attributes: ['cost_center_group'], group: ['cost_center_group']});
    const accounts = await Budget.findAll({ attributes: ['account_code', 'account_name'], group: ['account_code', 'account_name']});
    const years = await Budget.findAll({ attributes: ['year'], group: ['year']});

    console.log('Groups:', ccGroups.map(x => x.cost_center_group));
    console.log('Accounts:', accounts.map(x => x.account_code));
    console.log('Years:', years.map(x => x.year));

    // Cleanup
    await dummyBudget.destroy({ force: true });
    
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    process.exit();
  }
}

testSelectors();
