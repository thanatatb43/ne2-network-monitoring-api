/**
 * New budget dashboard API surface, built per BUDGET_DASHBOARD_BACKEND_API_SPEC.md.
 * Implements endpoints 1-5 from that spec (dashboard/summary, transactions,
 * transactions/aggregates, transactions/selectors upgrade, transactions/:id).
 * Endpoints 6-7 (the legacy /summary/:year and POST /transactions/find) are untouched
 * in budgetController.js / budgetTransactionController.js for backward compatibility.
 *
 * ============================================================================
 * DEVIATIONS FROM THE SPEC — the spec asked several questions of "backend/data
 * owner" (section 12) that nobody has answered yet. Rather than block on that,
 * this file makes an explicit, documented choice for each one from what the
 * actual data already implies. Anyone correcting these should search this file
 * for "DECISION:" and update both the code and this list.
 *
 * 1. fiscal_year = plain calendar year (Jan 1 - Dec 31), not an Oct-Sep fiscal
 *    year as the spec's example implied. BudgetTransaction.year is already a
 *    plain calendar year (verified against real data: a row with year=2025 has
 *    posting_date 2025-01-27), and Budget.year is the same. There is no fiscal
 *    year concept anywhere else in this codebase to align with instead.
 *
 * 2. amount sign: positive = debit/spent, negative = credit/reversal. This is
 *    not new - it's the same convention buildTransactionSummary() already used
 *    in budgetTransactionController.js (value > 0 -> spent, value < 0 -> not_spent).
 *    amount_direction is derived from the sign, not a stored field.
 *
 * 3. account_code === cost_center. Budget.account_code and
 *    BudgetTransaction.cost_center are literally the same identifier -
 *    syncBudgetFromTransactions() in budgetTransactionController.js sets
 *    `const account_code = cost_center` directly. The new filter contract
 *    accepts both `account_code` (preferred) and `cost_center` (deprecated
 *    alias, flagged in meta.deprecations) for the same column.
 *
 * 4. "spent" (dashboard/summary, and totals.net in aggregates) is the NET sum
 *    of value_co_curr (debits + credits), matching the existing budget_used
 *    semantics in Budgets. Gross debit/credit are also exposed separately in
 *    /transactions/aggregates for full transparency, since the spec explicitly
 *    asks for both.
 *
 * 5. Budget/transaction data is public (no auth), matching how every other GET
 *    read endpoint in this app is public by default (see officeEquipmentRoutes,
 *    the existing /summary/:year, /selectors, /transactions/selectors,
 *    /transactions/find - none of them require a token). Only the upload
 *    endpoint mutates data and stays behind hasRole().
 *
 * 6. username / description / reference_doc_no are NOT redacted - same as
 *    every existing budget endpoint already returns them unfiltered.
 *
 * 7. linked_jobs is NOT implemented - there is no relation table between
 *    BudgetTransaction and PeaJob in this schema. `linked_job_count` is
 *    hard-coded to 0 and GET /transactions/:id never returns a `linked_jobs`
 *    array. This needs real schema work (a join table) before it can exist;
 *    flagging rather than faking it.
 * ============================================================================
 */

const crypto = require('crypto');
const { Sequelize, Op } = require('sequelize');
const { BudgetTransaction, Budget, sequelize } = require('../models');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Formats money as a 2-dp decimal string. MySQL returns DECIMAL columns and
// SUM(DECIMAL) as exact strings - those are formatted by string manipulation so a
// total is never rounded through a JS float. Numbers (only ever computed ratios
// like usage_percentage/average in this file) fall back to toFixed.
const toMoney = (n) => {
  if (n === null || n === undefined || n === '') return '0.00';
  if (typeof n === 'string') {
    const m = n.trim().match(/^(-?)(\d+)(?:\.(\d*))?$/);
    if (m) {
      const frac = (m[3] || '');
      if (frac.length <= 2) {
        const whole = m[2].replace(/^0+(?=\d)/, '');
        const out = `${whole}.${frac.padEnd(2, '0')}`;
        return m[1] && out !== '0.00' ? `-${out}` : out;
      }
    }
  }
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toFixed(2);
};

const sendError = (res, status, code, message, fields) => {
  const body = {
    success: false,
    error: { code, message },
    request_id: `req_${crypto.randomUUID()}`
  };
  if (fields) body.error.fields = fields;
  return res.status(status).json(body);
};

const isValidYYYYMM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ---------------------------------------------------------------------------
// Global search `q` - "literal-v1" semantics (REMAINING_UX_UI_BACKEND_API_SPEC.md B1):
// the whole trimmed string is one case-insensitive literal substring, ORed across
// every searchable field. %, _ and \ are literal characters, not wildcards. A NULL
// column never matches (LIKE on NULL is NULL, not true), so a missing value is
// never found by typing "null".
// ---------------------------------------------------------------------------
const Q_MAX_CODE_POINTS = 200;
const SEARCH_META = { version: 'literal-v1', scope: 'all_filtered_records' };

// Escape LIKE metacharacters using MySQL's default escape char (backslash). The
// pattern is still sent as a bound value, so this only neutralises wildcards -
// it's not what protects against injection.
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// Each searchable response field and the SQL expression that renders it exactly as
// it appears in the response (ISO dates, canonical decimal, plain integer ids), so
// what the user sees is what they can search for.
const SEARCH_COLUMNS = [
  'id',                // transaction_id
  'reference_doc_no',
  'description',
  'cost_center',       // account_code (cost_center is its alias - same column, not repeated)
  'cost_center_name',  // account_name and cost_center_name - same column
  'clearing_account',  // clearing_account_code
  'clearing_account_name',
  'username',
  'year',              // fiscal_year
  'document_date',     // YYYY-MM-DD
  'posting_date',      // YYYY-MM-DD - also covers posting_month (YYYY-MM is a prefix of it)
  'value_co_curr'      // amount, canonical decimal e.g. -1200.50
];

const buildSearchPredicate = (q) => {
  const pattern = `%${escapeLike(q.toLowerCase())}%`;
  const ors = SEARCH_COLUMNS.map((col) =>
    Sequelize.where(
      Sequelize.fn('LOWER', Sequelize.cast(Sequelize.col(col), 'CHAR')),
      { [Op.like]: pattern }
    )
  );

  // amount_direction and currency are derived, not stored - match them the same way
  // rowToTransaction renders them, so searching "credit" or "thb" behaves literally.
  const lower = q.toLowerCase();
  if ('debit'.includes(lower)) ors.push({ value_co_curr: { [Op.gte]: 0 } });
  if ('credit'.includes(lower)) ors.push({ value_co_curr: { [Op.lt]: 0 } });
  if ('thb'.includes(lower)) ors.push(Sequelize.literal('1 = 1'));

  return { [Op.or]: ors };
};

/**
 * Parses+validates the common filter set shared by /transactions and
 * /transactions/aggregates. Returns { where, applied, error } - error is a
 * {status, code, message, fields} object when validation fails, otherwise null.
 */
const parseCommonFilters = (query) => {
  const applied = {};
  const where = {};
  const deprecations = [];
  // Predicates that aren't a plain column match (posting_month, q) are collected here
  // and ANDed in, so they compose with each other and with the column filters.
  const extra = [];

  // fiscal_year
  let fiscalYear = null;
  if (query.fiscal_year !== undefined && query.fiscal_year !== '') {
    fiscalYear = parseInt(query.fiscal_year, 10);
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2023 || fiscalYear > 2100) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'fiscal_year must be an integer between 2023 and 2100', fields: { fiscal_year: 'Invalid value' } } };
    }
    where.year = fiscalYear;
    applied.fiscal_year = fiscalYear;
  }

  // account_code, with cost_center accepted as a deprecated alias for the same column
  const accountCode = query.account_code || query.cost_center;
  if (accountCode) {
    where.cost_center = accountCode;
    applied.account_code = accountCode;
    if (!query.account_code && query.cost_center) deprecations.push('cost_center is deprecated as a filter name - use account_code instead (same underlying field)');
  }

  if (query.clearing_account_code) {
    where.clearing_account = query.clearing_account_code;
    applied.clearing_account_code = query.clearing_account_code;
  }

  if (query.clearing_account_name) {
    where.clearing_account_name = { [Op.substring]: query.clearing_account_name };
    applied.clearing_account_name = query.clearing_account_name;
  }

  if (query.username) {
    where.username = { [Op.substring]: query.username };
    applied.username = query.username;
  }

  if (query.reference_doc_no) {
    where.reference_doc_no = { [Op.substring]: query.reference_doc_no };
    applied.reference_doc_no = query.reference_doc_no;
  }

  if (query.description) {
    where.description = { [Op.substring]: query.description };
    applied.description = query.description;
  }

  if (query.posting_month !== undefined && query.posting_month !== '') {
    if (!isValidYYYYMM(query.posting_month)) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'posting_month must be in YYYY-MM format', fields: { posting_month: 'Invalid value' } } };
    }
    const monthYear = parseInt(query.posting_month.slice(0, 4), 10);
    if (fiscalYear !== null && monthYear !== fiscalYear) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'posting_month is not within fiscal_year', fields: { posting_month: 'Outside fiscal_year' } } };
    }
    extra.push(Sequelize.where(Sequelize.fn('LEFT', Sequelize.col('posting_date'), 7), query.posting_month));
    applied.posting_month = query.posting_month;
  }

  if (query.date_from || query.date_to) {
    if (query.date_from && !isValidDate(query.date_from)) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'date_from must be YYYY-MM-DD', fields: { date_from: 'Invalid value' } } };
    }
    if (query.date_to && !isValidDate(query.date_to)) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'date_to must be YYYY-MM-DD', fields: { date_to: 'Invalid value' } } };
    }
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'date_from must be <= date_to', fields: { date_from: 'After date_to' } } };
    }
    const range = {};
    if (query.date_from) range[Op.gte] = query.date_from;
    if (query.date_to) range[Op.lte] = query.date_to;
    where.posting_date = range;
    if (query.date_from) applied.date_from = query.date_from;
    if (query.date_to) applied.date_to = query.date_to;
  }

  if (query.amount_direction !== undefined && query.amount_direction !== '') {
    if (!['debit', 'credit', 'all'].includes(query.amount_direction)) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: 'amount_direction must be debit, credit or all', fields: { amount_direction: 'Invalid value' } } };
    }
    if (query.amount_direction === 'debit') where.value_co_curr = { [Op.gt]: 0 };
    else if (query.amount_direction === 'credit') where.value_co_curr = { [Op.lt]: 0 };
    applied.amount_direction = query.amount_direction;
  }

  // q - global literal search (REMAINING_UX_UI_BACKEND_API_SPEC.md, B1)
  let q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q !== '') {
    if ([...q].length > Q_MAX_CODE_POINTS) {
      return { error: { status: 400, code: 'INVALID_QUERY', message: `q must not exceed ${Q_MAX_CODE_POINTS} characters`, fields: { q: 'Too long' } } };
    }
    extra.push(buildSearchPredicate(q));
    applied.q = q;
  }

  if (extra.length) where[Op.and] = extra;

  return { where, applied, deprecations, error: null };
};

// meta.search is always present (not only when q is sent) so the frontend can tell
// that server-side search is deployed from the response itself, not from a 200.
const buildListMeta = (parsed) => ({
  generated_at: new Date().toISOString(),
  currency: 'THB',
  applied_filters: parsed.applied,
  search: SEARCH_META,
  ...(parsed.deprecations && parsed.deprecations.length ? { deprecations: parsed.deprecations } : {})
});

const rowToTransaction = (row) => {
  const isDebit = row.value_co_curr !== null && Number(row.value_co_curr) >= 0;
  return {
    transaction_id: String(row.id),
    fiscal_year: row.year,
    document_date: row.document_date, // already YYYY-MM-DD via raw query (model getter bypassed)
    posting_date: row.posting_date,
    posting_month: row.posting_date ? row.posting_date.slice(0, 7) : null,
    reference_doc_no: row.reference_doc_no,
    description: row.description,
    account_code: row.cost_center,
    account_name: row.cost_center_name,
    cost_center: row.cost_center,
    cost_center_name: row.cost_center_name,
    clearing_account_code: row.clearing_account,
    clearing_account_name: row.clearing_account_name,
    username: row.username,
    amount: toMoney(row.value_co_curr),
    amount_direction: row.value_co_curr === null ? null : (isDebit ? 'debit' : 'credit'),
    currency: 'THB',
    // No BudgetTransaction <-> PeaJob relation exists yet - see file header, deviation 7.
    linked_job_count: 0
  };
};

// ---------------------------------------------------------------------------
// 1. GET /api/budgets/dashboard/summary
// ---------------------------------------------------------------------------
const getDashboardSummary = async (req, res, next) => {
  try {
    const fiscalYearRaw = req.query.fiscal_year;
    if (!fiscalYearRaw) {
      return sendError(res, 400, 'INVALID_QUERY', 'fiscal_year is required', { fiscal_year: 'Required' });
    }
    const fiscalYear = parseInt(fiscalYearRaw, 10);
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2023 || fiscalYear > 2100) {
      return sendError(res, 400, 'INVALID_QUERY', 'fiscal_year must be an integer between 2023 and 2100', { fiscal_year: 'Invalid value' });
    }

    let topUsersLimit = req.query.top_users_limit !== undefined ? parseInt(req.query.top_users_limit, 10) : 10;
    if (!Number.isInteger(topUsersLimit) || topUsersLimit < 1 || topUsersLimit > 20) {
      return sendError(res, 400, 'INVALID_QUERY', 'top_users_limit must be an integer between 1 and 20', { top_users_limit: 'Invalid value' });
    }

    // Allocated + account_name: latest Budget snapshot per account_code for this year
    // (same "first row wins, sorted newest-first" logic as the legacy getBudgetSummary).
    const budgetRows = await Budget.findAll({
      where: { year: fiscalYear },
      order: [['account_code', 'ASC'], ['period', 'DESC'], ['month', 'DESC'], ['day', 'DESC']],
      raw: true
    });
    const latestBudgetByAccount = new Map();
    budgetRows.forEach((b) => {
      if (!latestBudgetByAccount.has(b.account_code)) latestBudgetByAccount.set(b.account_code, b);
    });

    // Spent per account_code: computed live from BudgetTransaction (net sum), not from
    // the Budget snapshot, so this stays consistent with /transactions/aggregates.
    const spentRows = await BudgetTransaction.findAll({
      attributes: [
        'cost_center',
        [Sequelize.fn('MAX', Sequelize.col('cost_center_name')), 'cost_center_name'],
        [Sequelize.fn('SUM', Sequelize.col('value_co_curr')), 'net_spent'],
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'transaction_count']
      ],
      where: { year: fiscalYear },
      group: ['cost_center'],
      raw: true
    });
    const spentByAccount = new Map(spentRows.map((r) => [r.cost_center, r]));

    // Union of account codes that have a budget row and/or transactions this year
    const accountCodes = new Set([...latestBudgetByAccount.keys(), ...spentByAccount.keys()]);

    // Top users per account, in one grouped query rather than N+1
    const topUserRows = await BudgetTransaction.findAll({
      attributes: [
        'cost_center', 'username',
        [Sequelize.fn('SUM', Sequelize.col('value_co_curr')), 'spent'],
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'transaction_count']
      ],
      where: { year: fiscalYear, username: { [Op.ne]: null } },
      group: ['cost_center', 'username'],
      raw: true
    });
    const topUsersByAccount = new Map();
    topUserRows.forEach((r) => {
      if (!topUsersByAccount.has(r.cost_center)) topUsersByAccount.set(r.cost_center, []);
      topUsersByAccount.get(r.cost_center).push(r);
    });
    topUsersByAccount.forEach((list) => list.sort((a, b) => Number(b.spent) - Number(a.spent)));

    let totalAllocated = 0;
    let totalSpent = 0;
    const accounts = [...accountCodes].map((code) => {
      const budget = latestBudgetByAccount.get(code);
      const spentRow = spentByAccount.get(code);
      const allocated = budget ? Number(budget.budget_allocated) : 0;
      const spent = spentRow ? Number(spentRow.net_spent) : 0;
      const remaining = allocated - spent;
      const usagePct = allocated > 0 ? (spent / allocated) * 100 : 0;

      totalAllocated += allocated;
      totalSpent += spent;

      return {
        account_code: code,
        account_name: (budget && budget.account_name) || (spentRow && spentRow.cost_center_name) || null,
        allocated: toMoney(allocated),
        spent: toMoney(spent),
        remaining: toMoney(remaining),
        usage_percentage: toMoney(usagePct),
        transaction_count: spentRow ? Number(spentRow.transaction_count) : 0,
        top_users: (topUsersByAccount.get(code) || []).slice(0, topUsersLimit).map((u) => ({
          username: u.username,
          display_name: null, // no user directory to map to a display name - see deviation 7 area
          spent: toMoney(u.spent),
          transaction_count: Number(u.transaction_count)
        }))
      };
    }).sort((a, b) => (Number(b.spent) - Number(a.spent)) || a.account_code.localeCompare(b.account_code));

    // data_through: latest posting_date seen this year, for the "as of" freshness indicator
    const latest = await BudgetTransaction.findOne({
      where: { year: fiscalYear },
      order: [['posting_date', 'DESC']],
      raw: true,
      attributes: ['posting_date']
    });
    const dataThrough = latest ? latest.posting_date : null;

    // Elapsed months for the average - from Jan of fiscal_year through data_through's
    // month (inclusive), minimum 1 to avoid a divide-by-zero when there's no data yet.
    let elapsedMonths = 1;
    if (dataThrough) {
      elapsedMonths = Math.max(1, parseInt(dataThrough.slice(5, 7), 10));
    }

    const totalRemaining = totalAllocated - totalSpent;
    const totalUsagePct = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        fiscal_year: fiscalYear,
        period: {
          // See file header deviation 1: this is a plain calendar year, not Oct-Sep.
          start_date: `${fiscalYear}-01-01`,
          end_date: `${fiscalYear}-12-31`,
          data_through: dataThrough
        },
        totals: {
          allocated: toMoney(totalAllocated),
          spent: toMoney(totalSpent),
          remaining: toMoney(totalRemaining),
          usage_percentage: toMoney(totalUsagePct),
          average_monthly_spent: toMoney(totalSpent / elapsedMonths)
        },
        accounts
      },
      meta: {
        generated_at: new Date().toISOString(),
        currency: 'THB',
        source_updated_at: dataThrough ? new Date(dataThrough).toISOString() : null
      }
    });
  } catch (error) {
    console.error('[BudgetDashboard] getDashboardSummary failed:', error);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to build dashboard summary');
  }
};

// ---------------------------------------------------------------------------
// 2. GET /api/budgets/transactions (new paginated/filterable/sortable contract)
// ---------------------------------------------------------------------------
const SORT_COLUMNS = {
  posting_date: 'posting_date',
  document_date: 'document_date',
  reference_doc_no: 'reference_doc_no',
  description: 'description',
  account_code: 'cost_center',
  cost_center: 'cost_center',
  clearing_account_name: 'clearing_account_name',
  username: 'username',
  amount: 'value_co_curr'
};
const PAGE_SIZES = [10, 15, 25, 50, 100];

const getTransactionsList = async (req, res, next) => {
  try {
    const parsed = parseCommonFilters(req.query);
    if (parsed.error) return sendError(res, parsed.error.status, parsed.error.code, parsed.error.message, parsed.error.fields);

    const page = req.query.page !== undefined ? parseInt(req.query.page, 10) : 1;
    if (!Number.isInteger(page) || page < 1) {
      return sendError(res, 400, 'INVALID_QUERY', 'page must be an integer >= 1', { page: 'Invalid value' });
    }

    const pageSize = req.query.page_size !== undefined ? parseInt(req.query.page_size, 10) : 15;
    if (!PAGE_SIZES.includes(pageSize)) {
      return sendError(res, 400, 'INVALID_QUERY', `page_size must be one of ${PAGE_SIZES.join(', ')}`, { page_size: 'Invalid value' });
    }

    const sortKey = req.query.sort || 'posting_date';
    if (!SORT_COLUMNS[sortKey]) {
      return sendError(res, 400, 'INVALID_QUERY', `sort must be one of ${Object.keys(SORT_COLUMNS).join(', ')}`, { sort: 'Invalid value' });
    }
    const sortDirection = (req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const sortColumn = SORT_COLUMNS[sortKey];
    const { count, rows } = await BudgetTransaction.findAndCountAll({
      where: parsed.where,
      order: [
        // NULLs always last, in both directions - MySQL's own default flips them
        // between ASC and DESC, which would move rows across pages when a user
        // toggles sort order.
        [Sequelize.literal(`\`${sortColumn}\` IS NULL`), 'ASC'],
        [sortColumn, sortDirection],
        ['id', 'DESC'] // stable tie-breaker so paging never repeats or skips a row
      ],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      raw: true // bypass the model's DD.MM.YYYY date getters - we need ISO here
    });

    res.status(200).json({
      success: true,
      data: rows.map(rowToTransaction),
      pagination: {
        page,
        page_size: pageSize,
        total_items: count,
        total_pages: Math.ceil(count / pageSize) // 0 when nothing matched
      },
      // Kept at the top level for callers already reading it here; also echoed in
      // meta per REMAINING_UX_UI_BACKEND_API_SPEC.md B1.
      applied_filters: parsed.applied,
      meta: buildListMeta(parsed)
    });
  } catch (error) {
    console.error('[BudgetDashboard] getTransactionsList failed:', error);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list transactions');
  }
};

// ---------------------------------------------------------------------------
// 3. GET /api/budgets/transactions/aggregates
// ---------------------------------------------------------------------------
const getTransactionsAggregates = async (req, res, next) => {
  try {
    const parsed = parseCommonFilters(req.query);
    if (parsed.error) return sendError(res, parsed.error.status, parsed.error.code, parsed.error.message, parsed.error.fields);

    const totalsRow = await BudgetTransaction.findOne({
      attributes: [
        [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN value_co_curr > 0 THEN value_co_curr ELSE 0 END')), 'debit'],
        [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN value_co_curr < 0 THEN value_co_curr ELSE 0 END')), 'credit'],
        [Sequelize.fn('SUM', Sequelize.col('value_co_curr')), 'net'],
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'transaction_count'],
        [Sequelize.fn('MIN', Sequelize.col('posting_date')), 'first_posting_date'],
        [Sequelize.fn('MAX', Sequelize.col('posting_date')), 'last_posting_date'],
        [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN posting_date IS NULL THEN 1 ELSE 0 END')), 'records_without_posting_date'],
        // Lets a caller reconcile: SUM(by_month.net) + amount_without_posting_date = totals.net
        [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN posting_date IS NULL THEN value_co_curr ELSE 0 END')), 'amount_without_posting_date']
      ],
      where: parsed.where,
      raw: true
    });

    const monthRows = await BudgetTransaction.findAll({
      attributes: [
        [Sequelize.fn('LEFT', Sequelize.col('posting_date'), 7), 'month'],
        [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN value_co_curr > 0 THEN value_co_curr ELSE 0 END')), 'debit'],
        [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN value_co_curr < 0 THEN value_co_curr ELSE 0 END')), 'credit'],
        [Sequelize.fn('SUM', Sequelize.col('value_co_curr')), 'net'],
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'transaction_count']
      ],
      where: { ...parsed.where, posting_date: { ...(parsed.where.posting_date || {}), [Op.ne]: null } },
      group: [Sequelize.fn('LEFT', Sequelize.col('posting_date'), 7)],
      raw: true
    });
    const byMonthMap = new Map(monthRows.map((r) => [r.month, r]));

    // If fiscal_year was given, fill every month of that calendar year (even zero ones)
    // so a line chart doesn't show a gap. Without fiscal_year we can't know the intended
    // range, so we only report the months that actually have data.
    let by_month;
    if (parsed.applied.fiscal_year) {
      by_month = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${parsed.applied.fiscal_year}-${String(m).padStart(2, '0')}`;
        const r = byMonthMap.get(key);
        by_month.push({
          month: key,
          debit: toMoney(r ? r.debit : 0),
          credit: toMoney(r ? r.credit : 0),
          net: toMoney(r ? r.net : 0),
          transaction_count: r ? Number(r.transaction_count) : 0
        });
      }
    } else {
      by_month = monthRows
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((r) => ({
          month: r.month,
          debit: toMoney(r.debit),
          credit: toMoney(r.credit),
          net: toMoney(r.net),
          transaction_count: Number(r.transaction_count)
        }));
    }

    res.status(200).json({
      success: true,
      data: {
        totals: {
          debit: toMoney(totalsRow.debit),
          credit: toMoney(totalsRow.credit),
          net: toMoney(totalsRow.net),
          transaction_count: Number(totalsRow.transaction_count) || 0
        },
        by_month,
        coverage: {
          first_posting_date: totalsRow.first_posting_date,
          last_posting_date: totalsRow.last_posting_date,
          records_without_posting_date: Number(totalsRow.records_without_posting_date) || 0,
          amount_without_posting_date: toMoney(totalsRow.amount_without_posting_date)
        }
      },
      applied_filters: parsed.applied,
      meta: buildListMeta(parsed)
    });
  } catch (error) {
    console.error('[BudgetDashboard] getTransactionsAggregates failed:', error);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to build transaction aggregates');
  }
};

// ---------------------------------------------------------------------------
// 4. GET /api/budgets/transactions/selectors (new field/q/limit mode)
// Old no-field-param mode is handled by the existing getTransactionSelectors in
// budgetTransactionController.js - this only fires when ?field= is present, so
// both are mounted on the same route and neither breaks the other.
// ---------------------------------------------------------------------------
const SELECTOR_FIELDS = {
  account: { column: 'cost_center', labelColumn: 'cost_center_name' },
  cost_center: { column: 'cost_center', labelColumn: 'cost_center_name' }, // alias of "account"
  clearing_account: { column: 'clearing_account', labelColumn: 'clearing_account_name' },
  username: { column: 'username', labelColumn: null },
  reference_doc: { column: 'reference_doc_no', labelColumn: null },
  description: { column: 'description', labelColumn: null }
};

const getTransactionSelectorsV2 = async (req, res, next) => {
  try {
    const field = req.query.field;
    if (!SELECTOR_FIELDS[field]) {
      return sendError(res, 400, 'INVALID_QUERY', `field must be one of ${Object.keys(SELECTOR_FIELDS).join(', ')}`, { field: 'Invalid value' });
    }
    let limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return sendError(res, 400, 'INVALID_QUERY', 'limit must be an integer between 1 and 50', { limit: 'Invalid value' });
    }

    const { column, labelColumn } = SELECTOR_FIELDS[field];
    const where = { [column]: { [Op.ne]: null } };
    if (req.query.fiscal_year) where.year = parseInt(req.query.fiscal_year, 10);
    if (req.query.q) where[column] = { ...where[column], [Op.substring]: req.query.q };

    const attrs = labelColumn ? [column, labelColumn] : [column];
    const rows = await BudgetTransaction.findAll({
      attributes: attrs,
      where,
      group: attrs,
      raw: true
    });

    const seen = new Set();
    const options = rows
      .map((r) => {
        const value = r[column];
        const label = labelColumn && r[labelColumn] ? `${value} — ${r[labelColumn]}` : String(value);
        return { value, label };
      })
      .filter((o) => {
        if (seen.has(o.value)) return false;
        seen.add(o.value);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'th'))
      .slice(0, limit);

    res.status(200).json({
      success: true,
      data: { field, options },
      meta: { generated_at: new Date().toISOString() }
    });
  } catch (error) {
    console.error('[BudgetDashboard] getTransactionSelectorsV2 failed:', error);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load selector options');
  }
};

// ---------------------------------------------------------------------------
// 5. GET /api/budgets/transactions/:transaction_id
// ---------------------------------------------------------------------------
const getTransactionById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.transaction_id, 10);
    if (!Number.isInteger(id)) {
      return sendError(res, 400, 'INVALID_QUERY', 'transaction_id must be an integer', { transaction_id: 'Invalid value' });
    }

    const row = await BudgetTransaction.findByPk(id, { raw: true });
    if (!row) {
      return sendError(res, 404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
    }

    res.status(200).json({
      success: true,
      data: rowToTransaction(row)
      // linked_jobs intentionally omitted - see file header deviation 7.
    });
  } catch (error) {
    console.error('[BudgetDashboard] getTransactionById failed:', error);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load transaction');
  }
};

module.exports = {
  getDashboardSummary,
  getTransactionsList,
  getTransactionsAggregates,
  getTransactionSelectorsV2,
  getTransactionById
};
