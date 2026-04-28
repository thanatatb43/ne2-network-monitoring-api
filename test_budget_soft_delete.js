const { Budget } = require('./src/models');

async function testSoftDelete() {
  try {
    console.log('--- Testing Budget Soft Delete ---');

    // 1. Create a dummy record
    const dummyBudget = await Budget.create({
      cost_center_group: 'Operations',
      account_code: 'DELETE-ME',
      account_name: 'Temp Account',
      budget_used: 0,
      budget_allocated: 1000,
      year: 2026,
      month: 4
    });

    console.log(`Created Budget ID: ${dummyBudget.id}`);

    // 2. Delete it (should soft delete)
    await dummyBudget.destroy();
    console.log(`Destroyed Budget ID: ${dummyBudget.id}`);

    // 3. Verify it is not found normally
    const normalFind = await Budget.findByPk(dummyBudget.id);
    console.log(`Found normally: ${normalFind !== null}`);

    // 4. Verify it is found when including paranoid: false
    const paranoidFind = await Budget.findByPk(dummyBudget.id, { paranoid: false });
    console.log(`Found with paranoid=false: ${paranoidFind !== null}`);
    console.log(`deletedAt value: ${paranoidFind ? paranoidFind.deletedAt : 'N/A'}`);

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    process.exit();
  }
}

testSoftDelete();
