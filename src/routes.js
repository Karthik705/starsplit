// REST routes for groups ("constellations"), their members and their ledger.
const crypto = require('crypto');
const express = require('express');
const { tx } = require('./db');
const { q, loadState, memberIds } = require('./store');
const { cleanText, toCents, today, parseExpense } = require('./validate');
const { notify, subscribe } = require('./live');
const { rateLimit } = require('./rate-limit');
const { bad, notFound, HttpError } = require('./errors');
const { CURRENCIES, COLORS, CODE_ALPHABET, MAX_MEMBERS } = require('./constants');

const router = express.Router();
const createLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 40 });

function newCode() {
  return Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Send the fresh state back and tell everyone else watching the group. */
function done(res, code, status = 200) {
  notify(code);
  res.status(status).json(loadState(code));
}

const findMember = (members, id) => {
  const m = members.find((x) => x.id === Number(id));
  if (!m) throw notFound('Person not found');
  return m;
};

const sameName = (members, name, exceptId) =>
  members.some((m) => m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase());

// --- groups ------------------------------------------------------------------

router.post('/groups', createLimit, (req, res) => {
  const name = cleanText(req.body.name, 50);
  const currency = CURRENCIES.includes(req.body.currency) ? req.body.currency : 'USD';
  const names = [...new Set((req.body.members || []).map((n) => cleanText(n, 24)).filter(Boolean))];
  if (!name) throw bad('Give your constellation a name');
  if (names.length < 2) throw bad('Add at least two stars (people)');
  if (names.length > MAX_MEMBERS) throw bad(`Up to ${MAX_MEMBERS} people per constellation`);

  const code = tx(() => {
    let code = newCode();
    while (q.groupByCode.get(code)) code = newCode();
    const { lastInsertRowid: gid } = q.insGroup.run(code, name, currency);
    names.forEach((n, i) => q.insMember.run(gid, n, COLORS[i % COLORS.length]));
    return code;
  });
  res.status(201).json({ code });
});

router.get('/groups/:code', (req, res) => res.json(loadState(req.params.code)));

router.patch('/groups/:code', (req, res) => {
  const { group } = loadState(req.params.code);
  const name = cleanText(req.body.name, 50);
  if (!name) throw bad('Give your constellation a name');
  q.renameGroup.run(name, group.id);
  done(res, group.code);
});

router.get('/groups/:code/events', (req, res) => {
  const { group } = loadState(req.params.code);
  subscribe(group.code, req, res);
});

// --- members -----------------------------------------------------------------

router.post('/groups/:code/members', (req, res) => {
  const { group, members } = loadState(req.params.code);
  const name = cleanText(req.body.name, 24);
  if (!name) throw bad('Name required');
  if (members.length >= MAX_MEMBERS) throw bad(`Up to ${MAX_MEMBERS} people per constellation`);
  if (sameName(members, name)) throw bad('Someone with that name is already here');
  // pick the first colour nobody is using yet, so removals don't cause clashes
  const used = new Set(members.map((m) => m.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[members.length % COLORS.length];
  q.insMember.run(group.id, name, color);
  done(res, group.code, 201);
});

router.patch('/groups/:code/members/:id', (req, res) => {
  const { group, members } = loadState(req.params.code);
  const m = findMember(members, req.params.id);
  const name = cleanText(req.body.name, 24);
  if (!name) throw bad('Name required');
  if (sameName(members, name, m.id)) throw bad('Someone with that name is already here');
  q.renameMember.run(name, m.id, group.id);
  done(res, group.code);
});

router.delete('/groups/:code/members/:id', (req, res) => {
  const { group, members } = loadState(req.params.code);
  const m = findMember(members, req.params.id);
  if (members.length <= 2) throw bad('A constellation needs at least two people');
  if (q.memberInUse.get({ id: m.id })) throw new HttpError(409, `${m.name} is part of some expenses. Remove those first.`);
  q.delMember.run(m.id, group.id);
  done(res, group.code);
});

// --- ledger ------------------------------------------------------------------

router.post('/groups/:code/expenses', (req, res) => {
  const { group } = loadState(req.params.code);
  const e = parseExpense(req.body, group.id);
  tx(() => {
    const { lastInsertRowid: eid } = q.insExpense.run(group.id, e.description, e.amount, e.paidBy, e.category, 'expense', e.date);
    for (const s of e.splits) q.insSplit.run(eid, s.member_id, s.share_cents);
  });
  done(res, group.code, 201);
});

router.put('/groups/:code/expenses/:id', (req, res) => {
  const { group } = loadState(req.params.code);
  const id = Number(req.params.id);
  const e = parseExpense(req.body, group.id);
  tx(() => {
    const { changes } = q.updExpense.run(e.description, e.amount, e.paidBy, e.category, e.date, id, group.id);
    if (!changes) throw notFound('Expense not found');
    q.delSplits.run(id);
    for (const s of e.splits) q.insSplit.run(id, s.member_id, s.share_cents);
  });
  done(res, group.code);
});

// Settling up is stored as a "payment": `from` hands `amount` to `to`, which offsets both balances.
router.post('/groups/:code/settle', (req, res) => {
  const { group } = loadState(req.params.code);
  const valid = memberIds(group.id);
  const from = Number(req.body.from);
  const to = Number(req.body.to);
  const amount = toCents(req.body.amount);
  if (!valid.has(from) || !valid.has(to) || from === to) throw bad('Invalid payment');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : today();

  tx(() => {
    const { lastInsertRowid: eid } = q.insExpense.run(group.id, 'Settled up', amount, from, 'other', 'payment', date);
    q.insSplit.run(eid, to, amount);
  });
  done(res, group.code, 201);
});

router.delete('/groups/:code/expenses/:id', (req, res) => {
  const { group } = loadState(req.params.code);
  const { changes } = q.delExpense.run(Number(req.params.id), group.id);
  if (!changes) throw notFound('Expense not found');
  done(res, group.code);
});

module.exports = router;
