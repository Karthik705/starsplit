const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { db, tx } = require('./db');
const { buildSplits, computeNet, pairwiseDebts, simplify } = require('./balance');

const CATEGORIES = ['food', 'stay', 'travel', 'fun', 'groceries', 'other'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD'];
const SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares'];
const COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#ff375f', '#bf5af2', '#64d2ff', '#ac8e68', '#ff6482']; // iOS system colours
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)

const app = express();
app.set('trust proxy', 1); // running behind a hosting proxy: use the real client IP
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
app.get('/healthz', (req, res) => res.json({ ok: true }));

/** Tiny fixed-window, per-IP limiter (enough to blunt abuse without a Redis dependency). */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    next();
  };
}
const writeLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 300 });
const createLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 40 });
app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : writeLimit(req, res, next)));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

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
  insMember: db.prepare('INSERT INTO members (group_id, name, color) VALUES (?, ?, ?)'),
  insExpense: db.prepare(
    'INSERT INTO expenses (group_id, description, amount_cents, paid_by, category, kind, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  updExpense: db.prepare(
    "UPDATE expenses SET description = ?, amount_cents = ?, paid_by = ?, category = ?, spent_on = ? WHERE id = ? AND group_id = ? AND kind = 'expense'"
  ),
  insSplit: db.prepare('INSERT INTO splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)'),
  delSplits: db.prepare('DELETE FROM splits WHERE expense_id = ?'),
  delExpense: db.prepare('DELETE FROM expenses WHERE id = ? AND group_id = ?'),
};

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const toCents = (v) => {
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n <= 0 || n > 1e10) throw bad('Amount must be a positive number');
  return n;
};
const today = () => new Date().toISOString().slice(0, 10);
const cleanDate = (v) => {
  if (v === undefined || v === '') return today();
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad('Invalid date');
  return v;
};

function newCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function loadState(code) {
  const group = q.groupByCode.get(String(code).toUpperCase());
  if (!group) throw new HttpError(404, 'No constellation with that code');
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

/**
 * Validate an expense payload and turn it into rows.
 * Body: { description, amount, paidBy, category, date?, splitType?, split }
 * where `split` maps memberId -> value (amount / percent / shares; ignored for equal).
 * For backwards compatibility `splitAmong: [ids]` means an equal split.
 */
function parseExpense(body, groupId) {
  const valid = memberIds(groupId);
  const description = cleanText(body.description, 60);
  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const paidBy = Number(body.paidBy);
  const amount = toCents(body.amount);
  const splitType = SPLIT_TYPES.includes(body.splitType) ? body.splitType : 'equal';
  const date = cleanDate(body.date);

  if (!description) throw bad('Describe what this was for');
  if (!valid.has(paidBy)) throw bad('Unknown payer');

  let entries;
  if (body.split && typeof body.split === 'object') {
    entries = Object.entries(body.split).map(([id, v]) => ({
      member_id: Number(id),
      // exact amounts arrive as decimals, everything else is used as-is
      value: splitType === 'exact' ? Math.round(Number(v) * 100) : Number(v),
    }));
  } else {
    entries = (body.splitAmong || []).map((id) => ({ member_id: Number(id), value: 1 }));
  }
  entries = entries.filter((e) => splitType === 'equal' || e.value > 0);
  if (!entries.length) throw bad('Pick who shares this expense');
  if (!entries.every((e) => valid.has(e.member_id) && Number.isFinite(e.value) && e.value >= 0)) throw bad('Invalid split');
  if (new Set(entries.map((e) => e.member_id)).size !== entries.length) throw bad('Invalid split');

  let splits;
  try {
    splits = buildSplits(amount, splitType, entries);
  } catch (err) {
    throw bad(err.message);
  }
  return { description, category, paidBy, amount, date, splits };
}

// --- live sync (server-sent events) -----------------------------------------

const rooms = new Map(); // group code -> Set of open responses

function notify(code) {
  for (const res of rooms.get(code.toUpperCase()) || []) res.write('data: update\n\n');
}

app.get('/api/groups/:code/events', (req, res) => {
  const { group } = loadState(req.params.code);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(': connected\n\n');
  if (!rooms.has(group.code)) rooms.set(group.code, new Set());
  rooms.get(group.code).add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(beat);
    rooms.get(group.code)?.delete(res);
  });
});

// --- routes -----------------------------------------------------------------

app.post('/api/groups', createLimit, (req, res) => {
  const name = cleanText(req.body.name, 50);
  const currency = CURRENCIES.includes(req.body.currency) ? req.body.currency : 'USD';
  const names = [...new Set((req.body.members || []).map((n) => cleanText(n, 24)).filter(Boolean))];
  if (!name) throw bad('Give your constellation a name');
  if (names.length < 2) throw bad('Add at least two stars (people)');
  if (names.length > 12) throw bad('Up to 12 people per constellation');

  const code = tx(() => {
    let code = newCode();
    while (q.groupByCode.get(code)) code = newCode();
    const { lastInsertRowid: gid } = q.insGroup.run(code, name, currency);
    names.forEach((n, i) => q.insMember.run(gid, n, COLORS[i % COLORS.length]));
    return code;
  });
  res.status(201).json({ code });
});

app.get('/api/groups/:code', (req, res) => res.json(loadState(req.params.code)));

app.post('/api/groups/:code/members', (req, res) => {
  const { group, members } = loadState(req.params.code);
  const name = cleanText(req.body.name, 24);
  if (!name) throw bad('Name required');
  if (members.length >= 12) throw bad('Up to 12 people per constellation');
  if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw bad('Someone with that name is already here');
  q.insMember.run(group.id, name, COLORS[members.length % COLORS.length]);
  notify(group.code);
  res.status(201).json(loadState(req.params.code));
});

app.post('/api/groups/:code/expenses', (req, res) => {
  const { group } = loadState(req.params.code);
  const e = parseExpense(req.body, group.id);
  tx(() => {
    const { lastInsertRowid: eid } = q.insExpense.run(group.id, e.description, e.amount, e.paidBy, e.category, 'expense', e.date);
    for (const s of e.splits) q.insSplit.run(eid, s.member_id, s.share_cents);
  });
  notify(group.code);
  res.status(201).json(loadState(req.params.code));
});

app.put('/api/groups/:code/expenses/:id', (req, res) => {
  const { group } = loadState(req.params.code);
  const id = Number(req.params.id);
  const e = parseExpense(req.body, group.id);
  tx(() => {
    const { changes } = q.updExpense.run(e.description, e.amount, e.paidBy, e.category, e.date, id, group.id);
    if (!changes) throw new HttpError(404, 'Expense not found');
    q.delSplits.run(id);
    for (const s of e.splits) q.insSplit.run(id, s.member_id, s.share_cents);
  });
  notify(group.code);
  res.json(loadState(req.params.code));
});

// Settling up is stored as a "payment": `from` hands `amount` to `to`, which offsets both balances.
app.post('/api/groups/:code/settle', (req, res) => {
  const { group } = loadState(req.params.code);
  const valid = memberIds(group.id);
  const from = Number(req.body.from);
  const to = Number(req.body.to);
  const amount = toCents(req.body.amount);
  if (!valid.has(from) || !valid.has(to) || from === to) throw bad('Invalid payment');

  tx(() => {
    const { lastInsertRowid: eid } = q.insExpense.run(group.id, 'Settled up', amount, from, 'other', 'payment', today());
    q.insSplit.run(eid, to, amount);
  });
  notify(group.code);
  res.status(201).json(loadState(req.params.code));
});

app.delete('/api/groups/:code/expenses/:id', (req, res) => {
  const { group } = loadState(req.params.code);
  const { changes } = q.delExpense.run(Number(req.params.id), group.id);
  if (!changes) throw new HttpError(404, 'Expense not found');
  notify(group.code);
  res.json(loadState(req.params.code));
});

// --- errors -----------------------------------------------------------------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Starsplit running at http://localhost:${port}`));
}
module.exports = app;
