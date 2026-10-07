// Data access for groups and the derived state the API returns.
const { db } = require('./db');
const { deriveDebts } = require('./balance');
const { notFound } = require('./errors');

const findGroup = (code) => db.get('SELECT * FROM groups WHERE code = ?', [String(code).toUpperCase()]);
const listMembers = (groupId) => db.all('SELECT id, name, color FROM members WHERE group_id = ? ORDER BY id', [groupId]);

/** Everything the client needs for one group: ledger plus derived balances and debts. */
async function loadState(code) {
  const group = await findGroup(code);
  if (!group) throw notFound('No constellation with that code');
  const [members, expenseRows, splits] = await Promise.all([
    listMembers(group.id),
    db.all(
      `SELECT id, description, amount_cents, paid_by, category, kind, created_at,
              COALESCE(spent_on, date(created_at)) AS spent_on
       FROM expenses WHERE group_id = ? ORDER BY spent_on DESC, id DESC`, [group.id]),
    db.all('SELECT s.expense_id, s.member_id, s.share_cents FROM splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?', [group.id]),
  ]);
  const expenses = expenseRows.map((e) => ({ ...e, splits: [] }));
  const byId = new Map(expenses.map((e) => [e.id, e]));
  for (const s of splits) byId.get(s.expense_id)?.splits.push({ member_id: s.member_id, share_cents: s.share_cents });

  const { net, debts } = deriveDebts(members, expenses);
  return {
    group: { id: group.id, code: group.code, name: group.name, currency: group.currency },
    members,
    expenses,
    net,
    debts,
    totalSpent: expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount_cents, 0),
  };
}

const memberIds = async (groupId) => new Set((await listMembers(groupId)).map((m) => m.id));

const memberInUse = (id) =>
  db.get('SELECT 1 AS used FROM expenses WHERE paid_by = ? UNION SELECT 1 FROM splits WHERE member_id = ? LIMIT 1', [id, id]);

const myGroups = (userId) => db.all(
  `SELECT g.code, g.name, g.currency,
          (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id) AS people,
          (SELECT COALESCE(SUM(amount_cents), 0) FROM expenses e WHERE e.group_id = g.id AND e.kind = 'expense') AS total_cents,
          (SELECT MAX(COALESCE(spent_on, date(created_at))) FROM expenses e WHERE e.group_id = g.id) AS last_activity
   FROM user_groups ug JOIN groups g ON g.id = ug.group_id
   WHERE ug.user_id = ? ORDER BY ug.joined_at DESC, g.id DESC`, [userId]);

const linkUser = (userId, groupId) => db.run('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)', [userId, groupId]);
const unlinkUser = (userId, groupId) => db.run('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?', [userId, groupId]);

module.exports = { findGroup, loadState, memberIds, memberInUse, myGroups, linkUser, unlinkUser };
