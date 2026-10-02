// REST routes for groups ("constellations"), their members and their ledger.
const crypto = require('crypto');
const express = require('express');
const { db } = require('./db');
const { findGroup, loadState, memberIds, memberInUse, myGroups, linkUser, unlinkUser } = require('./store');
const { cleanText, toCents, today, parseExpense } = require('./validate');
const { notify, subscribe } = require('./live');
const { rateLimit } = require('./rate-limit');
const { bad, notFound, HttpError } = require('./errors');
const { CURRENCIES, COLORS, CODE_ALPHABET, MAX_MEMBERS } = require('./constants');
const { h } = require('./async');

const router = express.Router();
const createLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 40 });

function newCode() {
  return Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Send the fresh state back and tell everyone else watching the group. */
async function done(res, code, status = 200) {
  notify(code);
  res.status(status).json(await loadState(code));
}

const findMember = (members, id) => {
  const m = members.find((x) => x.id === Number(id));
  if (!m) throw notFound('Person not found');
  return m;
};

const sameName = (members, name, exceptId) =>
  members.some((m) => m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase());

/** Statements that insert an expense row followed by its splits, atomically in one batch. */
const expenseStmts = (groupId, e, kind = 'expense') => [
  ['INSERT INTO expenses (group_id, description, amount_cents, paid_by, category, kind, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [groupId, e.description, e.amount, e.paidBy, e.category, kind, e.date]],
  ...e.splits.map((s) => [
    'INSERT INTO splits (expense_id, member_id, share_cents) VALUES ((SELECT MAX(id) FROM expenses WHERE group_id = ?), ?, ?)',
    [groupId, s.member_id, s.share_cents],
  ]),
];

// --- groups ------------------------------------------------------------------

router.post('/groups', createLimit, h(async (req, res) => {
  const name = cleanText(req.body.name, 50);
  const currency = CURRENCIES.includes(req.body.currency) ? req.body.currency : 'USD';
  const names = [...new Set((req.body.members || []).map((n) => cleanText(n, 24)).filter(Boolean))];
  if (!name) throw bad('Give your constellation a name');
  if (names.length < 2) throw bad('Add at least two stars (people)');
  if (names.length > MAX_MEMBERS) throw bad(`Up to ${MAX_MEMBERS} people per constellation`);

  let code = newCode();
  while (await findGroup(code)) code = newCode();
  const gid = '(SELECT id FROM groups WHERE code = ?)';
  await db.batch([
    ['INSERT INTO groups (code, name, currency) VALUES (?, ?, ?)', [code, name, currency]],
    ...names.map((n, i) => [`INSERT INTO members (group_id, name, color) VALUES (${gid}, ?, ?)`, [code, n, COLORS[i % COLORS.length]]]),
    [`INSERT INTO user_groups (user_id, group_id) VALUES (?, ${gid})`, [req.user.id, code]],
  ]);
  res.status(201).json({ code });
}));

// your groups, for the home page
router.get('/me/groups', h(async (req, res) => res.json({ groups: await myGroups(req.user.id) })));

// opening a group by its code is how invites work: it gets added to your account
router.get('/groups/:code', h(async (req, res) => {
  const state = await loadState(req.params.code);
  await linkUser(req.user.id, state.group.id);
  res.json(state);
}));

// hide a group from your account (it keeps existing for everyone else)
router.delete('/me/groups/:code', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  await unlinkUser(req.user.id, group.id);
  res.json({ ok: true });
}));

router.patch('/groups/:code', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  const name = cleanText(req.body.name, 50);
  if (!name) throw bad('Give your constellation a name');
  await db.run('UPDATE groups SET name = ? WHERE id = ?', [name, group.id]);
  await done(res, group.code);
}));

router.get('/groups/:code/events', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  subscribe(group.code, req, res);
}));

// --- members -----------------------------------------------------------------

router.post('/groups/:code/members', h(async (req, res) => {
  const { group, members } = await loadState(req.params.code);
  const name = cleanText(req.body.name, 24);
  if (!name) throw bad('Name required');
  if (members.length >= MAX_MEMBERS) throw bad(`Up to ${MAX_MEMBERS} people per constellation`);
  if (sameName(members, name)) throw bad('Someone with that name is already here');
  // pick the first colour nobody is using yet, so removals don't cause clashes
  const used = new Set(members.map((m) => m.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[members.length % COLORS.length];
  await db.run('INSERT INTO members (group_id, name, color) VALUES (?, ?, ?)', [group.id, name, color]);
  await done(res, group.code, 201);
}));

router.patch('/groups/:code/members/:id', h(async (req, res) => {
  const { group, members } = await loadState(req.params.code);
  const m = findMember(members, req.params.id);
  const name = cleanText(req.body.name, 24);
  if (!name) throw bad('Name required');
  if (sameName(members, name, m.id)) throw bad('Someone with that name is already here');
  await db.run('UPDATE members SET name = ? WHERE id = ? AND group_id = ?', [name, m.id, group.id]);
  await done(res, group.code);
}));

router.delete('/groups/:code/members/:id', h(async (req, res) => {
  const { group, members } = await loadState(req.params.code);
  const m = findMember(members, req.params.id);
  if (members.length <= 2) throw bad('A constellation needs at least two people');
  if (await memberInUse(m.id)) throw new HttpError(409, `${m.name} is part of some expenses. Remove those first.`);
  await db.run('DELETE FROM members WHERE id = ? AND group_id = ?', [m.id, group.id]);
  await done(res, group.code);
}));

// --- ledger ------------------------------------------------------------------

router.post('/groups/:code/expenses', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  const e = await parseExpense(req.body, group.id);
  await db.batch(expenseStmts(group.id, e));
  await done(res, group.code, 201);
}));

router.put('/groups/:code/expenses/:id', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  const id = Number(req.params.id);
  const e = await parseExpense(req.body, group.id);
  const exists = await db.get("SELECT 1 AS ok FROM expenses WHERE id = ? AND group_id = ? AND kind = 'expense'", [id, group.id]);
  if (!exists) throw notFound('Expense not found');
  await db.batch([
    ['UPDATE expenses SET description = ?, amount_cents = ?, paid_by = ?, category = ?, spent_on = ? WHERE id = ? AND group_id = ?',
      [e.description, e.amount, e.paidBy, e.category, e.date, id, group.id]],
    ['DELETE FROM splits WHERE expense_id = ?', [id]],
    ...e.splits.map((s) => ['INSERT INTO splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)', [id, s.member_id, s.share_cents]]),
  ]);
  await done(res, group.code);
}));

// Settling up is stored as a "payment": `from` hands `amount` to `to`, which offsets both balances.
router.post('/groups/:code/settle', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  const valid = await memberIds(group.id);
  const from = Number(req.body.from);
  const to = Number(req.body.to);
  const amount = toCents(req.body.amount);
  if (!valid.has(from) || !valid.has(to) || from === to) throw bad('Invalid payment');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : today();
  const payment = { description: 'Settled up', amount, paidBy: from, category: 'other', date, splits: [{ member_id: to, share_cents: amount }] };
  await db.batch(expenseStmts(group.id, payment, 'payment'));
  await done(res, group.code, 201);
}));

router.delete('/groups/:code/expenses/:id', h(async (req, res) => {
  const { group } = await loadState(req.params.code);
  const id = Number(req.params.id);
  const exists = await db.get('SELECT 1 AS ok FROM expenses WHERE id = ? AND group_id = ?', [id, group.id]);
  if (!exists) throw notFound('Expense not found');
  await db.batch([['DELETE FROM splits WHERE expense_id = ?', [id]], ['DELETE FROM expenses WHERE id = ?', [id]]]);
  await done(res, group.code);
}));

module.exports = router;
