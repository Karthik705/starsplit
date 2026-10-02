// Database: libSQL. Locally a SQLite file; in production a hosted Turso database
// (set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN), so data survives redeploys.
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

function connect() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'starsplit.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return createClient({ url: 'file:' + file });
}

const client = connect();

const SCHEMA = `
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

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '', -- '' for Google-only accounts
    google_sub TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  -- only hashes of session / reset tokens are stored, so a leaked database can't be used to log in
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  -- which groups show up in a user's account (creating or opening an invite adds it)
  CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_id)
  );
`;

// Columns added after the first release; ALTER is skipped when the column exists.
const MIGRATIONS = [
  ['expenses', 'spent_on', 'ALTER TABLE expenses ADD COLUMN spent_on TEXT'],
  ['users', 'google_sub', 'ALTER TABLE users ADD COLUMN google_sub TEXT'],
];

const ready = (async () => {
  await client.executeMultiple(SCHEMA);
  for (const [table, column, sql] of MIGRATIONS) {
    const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name);
    if (!cols.includes(column)) await client.execute(sql);
  }
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub)');
  await client.execute('PRAGMA foreign_keys = ON');
})();

const plain = (row) => (row ? { ...row } : row);
const exec = async (sql, args = []) => { await ready; return client.execute({ sql, args }); };

const db = {
  ready,
  all: async (sql, args) => (await exec(sql, args)).rows.map(plain),
  get: async (sql, args) => plain((await exec(sql, args)).rows[0]),
  /** Returns { changes, lastId }. */
  run: async (sql, args) => {
    const r = await exec(sql, args);
    return { changes: r.rowsAffected, lastId: r.lastInsertRowid === undefined ? undefined : Number(r.lastInsertRowid) };
  },
  /**
   * Run several statements atomically (all or nothing). Statements are [sql, args] pairs.
   * Inside one batch, `last_insert_rowid()` refers to the previous INSERT, which lets
   * a parent row and its children be written together.
   */
  batch: async (stmts) => {
    await ready;
    return client.batch(stmts.map(([sql, args = []]) => ({ sql, args })), 'write');
  },
};

module.exports = { db };
