const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'starsplit.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    paid_by INTEGER NOT NULL REFERENCES members(id),
    category TEXT NOT NULL DEFAULT 'other',
    kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','payment')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    spent_on TEXT
  );
  CREATE TABLE IF NOT EXISTS splits (
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id),
    share_cents INTEGER NOT NULL,
    PRIMARY KEY (expense_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
`);

// Migration for databases created before expenses had a spend date.
if (!db.prepare('PRAGMA table_info(expenses)').all().some((c) => c.name === 'spent_on')) {
  db.exec('ALTER TABLE expenses ADD COLUMN spent_on TEXT');
  db.exec('UPDATE expenses SET spent_on = date(created_at)');
}

/** Run `fn` inside a transaction; roll back if it throws. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, tx };
