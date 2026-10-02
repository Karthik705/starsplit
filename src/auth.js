// Accounts: email + password (scrypt), sessions in an httpOnly cookie.
const crypto = require('crypto');
const express = require('express');
const { db } = require('./db');
const { cleanText } = require('./validate');
const { rateLimit } = require('./rate-limit');
const { bad, HttpError } = require('./errors');

const COOKIE = 'ss_session';
const SESSION_DAYS = 30;
const secure = process.env.NODE_ENV === 'production';

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insUser: db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'),
  insSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  session: db.prepare(
    'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ),
  delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
};

// --- passwords ---------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function checkPassword(password, stored) {
  const [, salt, key] = stored.split('$');
  const want = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(got, want);
}
// compared against when the email is unknown, so response time doesn't reveal which emails exist
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

// --- sessions ----------------------------------------------------------------

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 864e5;
  q.insSession.run(sha(token), userId, Date.now() + maxAge);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' });
}

/** Attaches req.user when the session cookie is valid. */
function loadUser(req, res, next) {
  const token = readCookie(req);
  req.user = token ? q.session.get(sha(token), Date.now()) || null : null;
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in'));
  next();
}

setInterval(() => q.purge.run(Date.now()), 6 * 3600e3).unref();

// --- routes ------------------------------------------------------------------

const router = express.Router();
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

function cleanEmail(v) {
  const email = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw bad('Enter a valid email address');
  return email;
}

router.post('/signup', authLimit, (req, res) => {
  const name = cleanText(req.body.name, 40);
  const email = cleanEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name) throw bad('Tell us your name');
  if (password.length < 8) throw bad('Password must be at least 8 characters');
  if (password.length > 200) throw bad('Password is too long');
  if (q.userByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists. Log in instead?');
  const { lastInsertRowid: id } = q.insUser.run(email, name, hashPassword(password));
  startSession(res, Number(id));
  res.status(201).json({ user: { id: Number(id), email, name } });
});

router.post('/login', authLimit, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = q.userByEmail.get(email);
  const ok = checkPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Wrong email or password');
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const token = readCookie(req);
  if (token) q.delSession.run(sha(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

module.exports = { router, loadUser, requireUser };
