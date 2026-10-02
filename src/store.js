// Prepared queries and the derived group state the API returns.
const { db } = require('./db');
const { computeNet, pairwiseDebts, simplify } = require('./balance');
const { notFound } = require('./errors');

const q = {
  groupByCode: db.prepare('SELECT * FROM groups WHERE code = ?'),
  members: db.prepare('SELECT id, name, color FROM members WHERE group_id = ? ORDER BY id'),
  expenses: db.prepare(
    `SELECT id, description, amount_cents, paid_by, category, kind, created_at,
            COALESCE(spent_on, date(created_at)) AS spent_on
     FROM expenses WHERE group_id = ? ORDER BY spent_on DESC, id DESC`
  ),
  splits: db.prepare(
    'SELECT s.expense_id, s.member_id, s.share_cents FROM splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?'
  ),
  insGroup: db.prepare('INSERT INTO groups (code, name, currency) VALUES (?, ?, ?)'),
  renameGroup: db.prepare('UPDATE groups SET name = ? WHERE id = ?'),
  insMember: db.prepare('INSERT INTO members (group_id, name, color) VALUES (?, ?, ?)'),
  renameMember: db.prepare('UPDATE members SET name = ? WHERE id = ? AND group_id = ?'),
  delMember: db.prepare('DELETE FROM members WHERE id = ? AND group_id = ?'),
  memberInUse: db.prepare(
    'SELECT 1 FROM expenses WHERE paid_by = :id UNION SELECT 1 FROM splits WHERE member_id = :id LIMIT 1'
  ),
  insExpense: db.prepare(
    'INSERT INTO expenses (group_id, description, amount_cents, paid_by, category, kind, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  updExpense: db.prepare(
    "UPDATE expenses SET description = ?, amount_cents = ?, paid_by = ?, category = ?, spent_on = ? WHERE id = ? AND group_id = ? AND kind = 'expense'"
  ),
  link: db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)'),
  unlink: db.prepare('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?'),
  myGroups: db.prepare(
    `SELECT g.code, g.name, g.currency,
            (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id) AS people,
            (SELECT COALESCE(SUM(amount_cents), 0) FROM expenses e WHERE e.group_id = g.id AND e.kind = 'expense') AS total_cents,
            (SELECT MAX(COALESCE(spent_on, date(created_at))) FROM expenses e WHERE e.group_id = g.id) AS last_activity
     FROM user_groups ug JOIN groups g ON g.id = ug.group_id
     WHERE ug.user_id = ? ORDER BY ug.joined_at DESC, g.id DESC`
  ),
  insSplit: db.prepare('INSERT INTO splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)'),
  delSplits: db.prepare('DELETE FROM splits WHERE expense_id = ?'),
  delExpense: db.prepare('DELETE FROM expenses WHERE id = ? AND group_id = ?'),
};

/** Everything the client needs for one group: ledger plus derived balances and debts. */
function loadState(code) {
  const group = q.groupByCode.get(String(code).toUpperCase());
  if (!group) throw notFound('No constellation with that code');
  const members = q.members.all(group.id).map((m) => ({ ...m }));
  const expenses = q.expenses.all(group.id).map((e) => ({ ...e, splits: [] }));
  const byId = new Map(expenses.map((e) => [e.id, e]));
  for (const s of q.splits.all(group.id)) {
    byId.get(s.expense_id).splits.push({ member_id: s.member_id, share_cents: s.share_cents });
  }

  const net = computeNet(members, expenses);
  const simplified = simplify(net);
  return {
    group: { id: group.id, code: group.code, name: group.name, currency: group.currency },
    members,
    expenses,
    net,
    // once everyone nets to zero nothing is owed, so the tangled view is empty too
    debts: { raw: simplified.length ? pairwiseDebts(expenses) : [], simplified },
    totalSpent: expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount_cents, 0),
  };
}

const memberIds = (groupId) => new Set(q.members.all(groupId).map((m) => m.id));

module.exports = { q, loadState, memberIds };
