const { Budget } = require('./src/models');

async function testSummary() {
  try {
    console.log('--- Testing Budget Summary Logic ---');
    
    const year = 2026;
    
    // Create test data for one account with multiple entries
    console.log('Creating test data...');
    await Budget.create({
      cost_center_group: 'Test Group',
      account_code: 'TEST-01',
      account_name: 'Test Account',
      budget_allocated: 1000,
      budget_used: 100,
      year,
      month: 1,
      period: 1,
      day: 1
    });

    await Budget.create({
      cost_center_group: 'Test Group',
      account_code: 'TEST-01',
      account_name: 'Test Account',
      budget_allocated: 1000,
      budget_used: 250,
      year,
      month: 1,
      period: 2,
      day: 15
    });

    // Call the summary logic (manual emulation of the controller)
    const budgets = await Budget.findAll({
      where: { year },
      order: [
        ['account_code', 'ASC'],
        ['year', 'DESC'],
        ['period', 'DESC'],
        ['day', 'DESC']
      ]
    });

    const summaryMap = new Map();
    budgets.forEach(b => {
      if (!summaryMap.has(b.account_code)) {
        const allocated = parseFloat(b.budget_allocated) || 0;
        const used = parseFloat(b.budget_used) || 0;
        summaryMap.set(b.account_code, {
          account_code: b.account_code,
          budget_allocated: allocated,
          budget_used: used,
          remaining: allocated - used,
          percentage: (used / allocated) * 100
        });
      }
    });

    const result = summaryMap.get('TEST-01');
    console.log('Summary Result for TEST-01:', result);

    if (result.budget_used === 250 && result.remaining === 750 && result.percentage === 25) {
      console.log('SUCCESS: Latest record (period 2) was used and calculations are correct.');
    } else {
      console.log('FAILURE: Data mismatch.');
    }

    // Cleanup
    await Budget.destroy({ where: { account_code: 'TEST-01' } });

  } catch (error) {
    console.error('Test Failed:', error);
  } finally {
    process.exit();
  }
}

testSummary();
