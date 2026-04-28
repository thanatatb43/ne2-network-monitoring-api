const xlsx = require('xlsx');
const { BudgetTransaction } = require('./src/models');

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  if (typeof dateStr === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + dateStr * 86400000);
    return dt.toISOString().split('T')[0];
  }
  if (typeof dateStr === 'string') {
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }
  return null;
};

async function testUpload() {
  try {
    console.log('--- Testing Excel Upload Parser ---');

    const workbook = xlsx.readFile('test_transactions.csv');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: null });
    console.log('Keys:', Object.keys(rawData[0]));
    const transactionsToInsert = [];

    for (const row of rawData) {
      const transaction = {
        cost_center: row['สปก.ต้นทุน'] ? String(row['สปก.ต้นทุน']) : null,
        cost_center_name: row['ชื่อสปก.ต้นทุน'] || null,
        clearing_account: row['บ/ชหักล้าง'] ? String(row['บ/ชหักล้าง']) : null,
        clearing_account_name: row['ชื่อของบัญชีหักล้าง'] || null,
        username: row['ชื่อผู้ใช้'] || null,
        document_date: parseDate(row['ว/ทเอกสาร']),
        posting_date: parseDate(row['Postg Date']),
        reference_doc_no: row['RefDocNo'] ? String(row['RefDocNo']) : null,
        value_co_curr: row['Value COCurr'] ? parseFloat(String(row['Value COCurr']).replace(/,/g, '')) : null,
        description: row['ชื่อ'] || null
      };

      if (transaction.cost_center || transaction.value_co_curr) {
        transactionsToInsert.push(transaction);
      }
    }

    console.log(`Parsed ${transactionsToInsert.length} rows.`);
    console.log('Sample parsed data:', transactionsToInsert[0]);

    // Test DB Insertion
    await BudgetTransaction.bulkCreate(transactionsToInsert);
    console.log('Successfully inserted into DB.');

    // Cleanup
    await BudgetTransaction.destroy({ truncate: true, force: true });
    
  } catch (err) {
    console.error('Test Failed:', err);
  } finally {
    process.exit();
  }
}

testUpload();
