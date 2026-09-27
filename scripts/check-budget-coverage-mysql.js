'use strict';

// Opt-in verification of /api/budgets/transactions + /transactions/aggregates against a
// fixture that includes rows with posting_date = NULL - production data has none, so the
// coverage reconciliation (REMAINING_UX_UI_BACKEND_API_SPEC.md contract test 6) can't be
// proven against it.
//
// No persistent schema/data writes: on a single pooled connection it creates a
// TEMPORARY table named BudgetTransactions, which shadows the real table for that
// connection only, then runs the real controller handlers on that same connection.
// Other connections (the running server) keep seeing the real table throughout.
//
// Run: node scripts/check-budget-coverage-mysql.js
require('dotenv').config({ quiet: true });
const path = require('path');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');

const config = require('../src/config/database')[process.env.NODE_ENV || 'development'];
if (config.dialect !== 'mysql') throw new Error('This verification requires MySQL');

// One connection, never recycled mid-run - the TEMPORARY table only exists on it.
const sequelize = new Sequelize(config.database, config.username, config.password, {
  ...config, pool: { max: 1, min: 1, idle: 600000, acquire: 60000 }, logging: false
});

const BudgetTransaction = require('../src/models/budgettransaction')(sequelize, DataTypes);
const Budget = require('../src/models/budget')(sequelize, DataTypes);

// Hand the controller our single-connection models instead of the app's pool.
const modelsIndex = require.resolve(path.join(__dirname, '../src/models'));
require.cache[modelsIndex] = {
  id: modelsIndex, filename: modelsIndex, loaded: true,
  exports: { BudgetTransaction, Budget, sequelize }
};
const controller = require('../src/controllers/budgetDashboardController');

const call = (handler, query) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); return this; }
  };
  Promise.resolve(handler({ query, params: {} }, res, reject)).catch(reject);
});

// Integer satang, so no assertion here goes through a float either.
const cents = (s) => {
  const m = String(s).match(/^(-?)(\d+)\.(\d{2})$/);
  if (!m) throw new Error(`not a 2dp decimal string: ${s}`);
  const v = BigInt(m[2]) * 100n + BigInt(m[3]);
  return m[1] ? -v : v;
};

const A = '53032080';
const B = '53051060';
// posting_date NULL on rows 3, 4 and 6. Row 8 has NULL document_date/description.
const FIXTURE = [
  { cost_center: A, posting_date: '2026-01-15', document_date: '2026-01-14', value_co_curr: '1000.10', description: 'สายแลน ชุด1' },
  { cost_center: A, posting_date: '2026-01-20', document_date: '2026-01-20', value_co_curr: '-200.05', description: 'คืนสายแลน' },
  { cost_center: A, posting_date: null, document_date: '2026-02-01', value_co_curr: '500.00', description: 'สายไฟ ไม่ทราบเดือน' },
  { cost_center: A, posting_date: null, document_date: null, value_co_curr: '-75.25', description: 'ปรับลด ไม่ทราบเดือน' },
  { cost_center: B, posting_date: '2026-03-01', document_date: '2026-03-01', value_co_curr: '333.33', description: 'ค่าซ่อม' },
  { cost_center: B, posting_date: null, document_date: '2026-04-01', value_co_curr: '12.34', description: 'ค่าซ่อม ไม่ทราบเดือน' },
  { cost_center: A, posting_date: '2026-12-31', document_date: '2026-12-31', value_co_curr: '0.01', description: 'ปัดเศษ' },
  { cost_center: A, posting_date: '2026-06-10', document_date: null, value_co_curr: '999.99', description: null },
  // Different year - must never leak into fiscal_year=2026 results.
  { cost_center: A, posting_date: null, document_date: null, value_co_curr: '5000.00', description: 'ปีอื่น ไม่ทราบเดือน', year: 2025 }
];

// Expected values worked out by hand from FIXTURE above, not computed by the code under test.
const EXPECT_2026 = {
  count: 8, debit: '2845.77', credit: '-275.30', net: '2570.47',
  records_without_posting_date: 3, amount_without_posting_date: '437.09',
  months: { '2026-01': '800.05', '2026-03': '333.33', '2026-06': '999.99', '2026-12': '0.01' }
};

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  PASS ${name}`); };

const reconcile = (label, agg, listRows, listTotal) => {
  const t = agg.data.totals;
  const cov = agg.data.coverage;
  const monthNet = agg.data.by_month.reduce((s, m) => s + cents(m.net), 0n);
  const monthCount = agg.data.by_month.reduce((s, m) => s + m.transaction_count, 0);
  check(`${label}: debit + credit = net`, () => assert.equal(cents(t.debit) + cents(t.credit), cents(t.net)));
  check(`${label}: SUM(by_month.net) + amount_without_posting_date = net`, () =>
    assert.equal(monthNet + cents(cov.amount_without_posting_date), cents(t.net)));
  check(`${label}: SUM(by_month.count) + records_without_posting_date = count`, () =>
    assert.equal(monthCount + cov.records_without_posting_date, t.transaction_count));
  if (listRows) {
    check(`${label}: list total_items = aggregates count`, () => assert.equal(listTotal, t.transaction_count));
    check(`${label}: SUM(list amount) = aggregates net`, () =>
      assert.equal(listRows.reduce((s, r) => s + cents(r.amount), 0n), cents(t.net)));
  }
};

async function main() {
  // MySQL rejects "CREATE TEMPORARY TABLE X LIKE X", so copy the shape via a temp table
  // with another name first, then create the shadowing BudgetTransactions from that.
  await sequelize.query('CREATE TEMPORARY TABLE ne2_check_budget_shape LIKE BudgetTransactions');
  await sequelize.query('CREATE TEMPORARY TABLE BudgetTransactions LIKE ne2_check_budget_shape');
  const [[{ n }]] = await sequelize.query('SELECT COUNT(*) AS n FROM BudgetTransactions');
  assert.equal(n, 0, 'temporary table must start empty - otherwise we are not isolated from real data');

  await BudgetTransaction.bulkCreate(FIXTURE.map((r) => ({ year: 2026, username: 'FIXTURE', ...r })));

  console.log('\n[1] fiscal_year=2026 - totals and coverage match the hand-computed fixture');
  const agg = await call(controller.getTransactionsAggregates, { fiscal_year: '2026' });
  assert.equal(agg.status, 200);
  const list = await call(controller.getTransactionsList, { fiscal_year: '2026', page_size: '100' });
  const t = agg.body.data.totals;
  const cov = agg.body.data.coverage;
  check('count / debit / credit / net exact', () => {
    assert.equal(t.transaction_count, EXPECT_2026.count);
    assert.equal(t.debit, EXPECT_2026.debit);
    assert.equal(t.credit, EXPECT_2026.credit);
    assert.equal(t.net, EXPECT_2026.net);
  });
  check('coverage counts the 3 undated rows and their 437.09', () => {
    assert.equal(cov.records_without_posting_date, EXPECT_2026.records_without_posting_date);
    assert.equal(cov.amount_without_posting_date, EXPECT_2026.amount_without_posting_date);
  });
  check('undated rows are in totals but in no month bucket', () => {
    const byMonth = Object.fromEntries(agg.body.data.by_month.map((m) => [m.month, m.net]));
    assert.equal(agg.body.data.by_month.length, 12);
    for (const [month, net] of Object.entries(EXPECT_2026.months)) assert.equal(byMonth[month], net, month);
    assert.notEqual(agg.body.data.by_month.reduce((s, m) => s + cents(m.net), 0n), cents(t.net),
      'fixture must actually make monthly != totals, or this test proves nothing');
  });
  check('first/last posting date ignore the NULLs', () => {
    assert.equal(cov.first_posting_date, '2026-01-15');
    assert.equal(cov.last_posting_date, '2026-12-31');
  });
  check('the 2025 undated row does not leak in', () => assert.ok(!list.body.data.some((r) => r.amount === '5000.00')));
  reconcile('fiscal_year=2026', agg.body, list.body.data, list.body.pagination.total_items);

  console.log('\n[2] undated rows in the list');
  const undated = list.body.data.filter((r) => r.posting_date === null);
  check('3 undated rows returned with posting_date and posting_month null', () => {
    assert.equal(undated.length, 3);
    assert.ok(undated.every((r) => r.posting_month === null));
  });
  for (const order of ['asc', 'desc']) {
    const sorted = await call(controller.getTransactionsList, { fiscal_year: '2026', page_size: '100', sort: 'posting_date', order });
    const dates = sorted.body.data.map((r) => r.posting_date);
    check(`sort posting_date ${order}: NULLs last`, () => {
      assert.deepEqual(dates.slice(-3), [null, null, null]);
      assert.ok(dates.slice(0, -3).every((d) => d !== null));
    });
  }

  console.log('\n[3] q selecting only undated rows');
  const qAgg = await call(controller.getTransactionsAggregates, { fiscal_year: '2026', q: 'ไม่ทราบเดือน' });
  const qList = await call(controller.getTransactionsList, { fiscal_year: '2026', q: 'ไม่ทราบเดือน', page_size: '100' });
  check('everything lands in coverage, every month is zero', () => {
    assert.equal(qAgg.body.data.totals.transaction_count, 3);
    assert.equal(qAgg.body.data.totals.net, '437.09');
    assert.equal(qAgg.body.data.coverage.records_without_posting_date, 3);
    assert.equal(qAgg.body.data.coverage.amount_without_posting_date, '437.09');
    assert.ok(qAgg.body.data.by_month.every((m) => m.net === '0.00' && m.transaction_count === 0));
  });
  reconcile('q=ไม่ทราบเดือน', qAgg.body, qList.body.data, qList.body.pagination.total_items);

  console.log('\n[4] account filter splits the undated amount correctly');
  const accAgg = await call(controller.getTransactionsAggregates, { fiscal_year: '2026', account_code: A });
  const accList = await call(controller.getTransactionsList, { fiscal_year: '2026', account_code: A, page_size: '100' });
  check(`account ${A}: net 2224.80, 2 undated worth 424.75`, () => {
    assert.equal(accAgg.body.data.totals.net, '2224.80');
    assert.equal(accAgg.body.data.coverage.records_without_posting_date, 2);
    assert.equal(accAgg.body.data.coverage.amount_without_posting_date, '424.75');
  });
  reconcile(`account ${A}`, accAgg.body, accList.body.data, accList.body.pagination.total_items);

  console.log('\n[5] date filters exclude undated rows (they have no date to be in range)');
  const month = await call(controller.getTransactionsAggregates, { fiscal_year: '2026', posting_month: '2026-01' });
  check('posting_month=2026-01: 2 rows, coverage 0', () => {
    assert.equal(month.body.data.totals.transaction_count, 2);
    assert.equal(month.body.data.coverage.records_without_posting_date, 0);
    assert.equal(month.body.data.coverage.amount_without_posting_date, '0.00');
  });
  const range = await call(controller.getTransactionsAggregates, { date_from: '2026-01-01', date_to: '2026-12-31' });
  check('date range: 5 dated rows, coverage 0', () => {
    assert.equal(range.body.data.totals.transaction_count, 5);
    assert.equal(range.body.data.coverage.records_without_posting_date, 0);
  });
  reconcile('posting_month=2026-01', month.body);

  console.log('\n[6] NULL is never matched by text');
  const nullQ = await call(controller.getTransactionsList, { fiscal_year: '2026', q: 'null', page_size: '100' });
  check('q=null finds nothing although row 8 has NULL description/document_date', () =>
    assert.equal(nullQ.body.pagination.total_items, 0));

  console.log(`\n${passed} checks passed - no persistent data was written`);
}

main()
  .catch((error) => { console.error('\nFAILED:', error.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
