// Accounts: email + password (scrypt) or Google, sessions in an httpOnly cookie,
// and password reset by emailed link.
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { db } = require('./db');
const { cleanText } = require('./validate');
const { rateLimit } = require('./rate-limit');
const mail = require('./mail'); // used as mail.sendMail so tests can capture emails
const { bad, HttpError } = require('./errors');
const { h } = require('./async');

const COOKIE = 'ss_session';
const OAUTH_COOKIE = 'ss_oauth';
const SESSION_DAYS = 30;
const RESET_MINUTES = 30;
const secure = process.env.NODE_ENV === 'production';
const scrypt = promisify(crypto.scrypt);

const google = {
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  get enabled() { return Boolean(this.id && this.secret); },
};

/** Public base URL for links in emails and the OAuth redirect. */
const baseUrl = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

// --- passwords ---------------------------------------------------------------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function checkPassword(password, stored) {
  const [kind, salt, key] = (stored || '').split('$');
  if (kind !== 'scrypt') return false; // e.g. a Google-only account
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(got, want);
}
// compared against when the email is unknown, so response time doesn't reveal which emails exist
const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));

function validPassword(v) {
  const password = typeof v === 'string' ? v : '';
  if (password.length < 8) throw bad('Password must be at least 8 characters');
  if (password.length > 200) throw bad('Password is too long');
  return password;
}

// --- sessions ----------------------------------------------------------------

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function startSession(res, userId) {
  const token = newToken();
  const maxAge = SESSION_DAYS * 864e5;
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), userId, Date.now() + maxAge]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' });
}

/** Attaches req.user when the session cookie is valid. */
const loadUser = h(async (req, res, next) => {
  const token = readCookie(req, COOKIE);
  req.user = token
    ? (await db.get(
      'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      [sha(token), Date.now()])) || null
    : null;
  next();
});

function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in'));
  next();
}

setInterval(() => {
  db.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]).catch(() => {});
  db.run('DELETE FROM password_resets WHERE expires_at <= ?', [Date.now()]).catch(() => {});
}, 6 * 3600e3).unref();

// --- routes ------------------------------------------------------------------

const router = express.Router();
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const userByEmail = (email) => db.get('SELECT * FROM users WHERE email = ?', [email]);
const normEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function cleanEmail(v) {
  const email = normEmail(v);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw bad('Enter a valid email address');
  return email;
}

router.post('/signup', authLimit, h(async (req, res) => {
  const name = cleanText(req.body.name, 40);
  const email = cleanEmail(req.body.email);
  const password = validPassword(req.body.password);
  if (!name) throw bad('Tell us your name');
  if (await userByEmail(email)) throw new HttpError(409, 'An account with that email already exists. Log in instead?');
  const { lastId: id } = await db.run('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [email, name, await hashPassword(password)]);
  await startSession(res, id);
  res.status(201).json({ user: { id, email, name } });
}));

router.post('/login', authLimit, h(async (req, res) => {
  const email = normEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await userByEmail(email);
  const ok = await checkPassword(password, user ? user.password_hash : await dummyHash);
  if (!user || !ok) {
    if (user && !user.password_hash) throw new HttpError(401, 'This account uses Google. Continue with Google, or reset your password to add one.');
    throw new HttpError(401, 'Wrong email or password');
  }
  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', h(async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha(token)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

router.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, google: google.enabled }));

// --- forgot / reset password ---------------------------------------------------

// Always answers the same way, so it can't be used to discover which emails have accounts.
router.post('/forgot', authLimit, h(async (req, res) => {
  const user = await userByEmail(normEmail(req.body.email));
  if (user) {
    const token = newToken();
    await db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), user.id, Date.now() + RESET_MINUTES * 60e3]);
    const link = `${baseUrl(req)}/#/reset/${token}`;
    await mail.sendMail({
      to: user.email,
      subject: 'Reset your Starsplit password',
      text: `Hi ${user.name},\n\nUse this link to set a new password (valid for ${RESET_MINUTES} minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      html: `<p>Hi ${user.name.replace(/[<>&]/g, '')},</p><p>Use the button below to set a new password. It's valid for ${RESET_MINUTES} minutes.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#007aff;color:#fff;text-decoration:none;font-weight:600">Reset password</a></p>
        <p style="color:#888;font-size:13px">If you didn't ask for this, you can ignore this email.</p>`,
    });
  }
  res.json({ ok: true });
}));

router.post('/reset', authLimit, h(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = validPassword(req.body.password);
  const row = await db.get('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?', [sha(token), Date.now()]);
  if (!row) throw bad('This reset link is invalid or has expired. Ask for a new one.');
  // new password, and sign out every existing session (someone else may have had access)
  await db.batch([
    ['UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), row.user_id]],
    ['DELETE FROM password_resets WHERE user_id = ?', [row.user_id]],
    ['DELETE FROM sessions WHERE user_id = ?', [row.user_id]],
  ]);
  await startSession(res, row.user_id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  res.json({ user: publicUser(user) });
}));

// --- Sign in with Google (OAuth 2.0 authorization-code flow) ----------------------

const redirectUri = (req) => `${baseUrl(req)}/api/auth/google/callback`;
const safeNext = (v) => (typeof v === 'string' && /^#\/g\/[A-Za-z0-9]+$/.test(v) ? v : '#/');

router.get('/google', (req, res) => {
  if (!google.enabled) return res.status(404).json({ error: 'Google sign-in is not set up' });
  const state = newToken();
  // the state cookie ties the callback to this browser (CSRF protection)
  res.cookie(OAUTH_COOKIE, `${state}|${safeNext(req.query.next)}`, { httpOnly: true, sameSite: 'lax', secure, maxAge: 10 * 60e3, path: '/api/auth' });
  const params = new URLSearchParams({
    client_id: google.id, redirect_uri: redirectUri(req), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', h(async (req, res) => {
  const [state, next] = (readCookie(req, OAUTH_COOKIE) || '').split('|');
  res.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
  const fail = (why) => res.redirect(`/#/login?error=${encodeURIComponent(why)}`);
  if (!google.enabled) return fail('Google sign-in is not set up');
  if (req.query.error) return fail('Google sign-in was cancelled');
  if (!state || state !== req.query.state) return fail('Sign-in expired, please try again');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(req.query.code || ''), client_id: google.id, client_secret: google.secret,
      redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) return fail('Google sign-in failed');

  // The ID token came straight from Google over TLS, so its claims can be read directly
  // (OpenID Connect Core 3.1.3.7); we still check who it was issued for.
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
  const issuerOk = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  if (!issuerOk || claims.aud !== google.id || claims.exp * 1000 < Date.now()) return fail('Google sign-in failed');
  if (!claims.email_verified) return fail('Your Google email is not verified');

  const email = normEmail(claims.email);
  let user = await db.get('SELECT * FROM users WHERE google_sub = ?', [claims.sub]);
  if (!user) {
    user = await userByEmail(email);
    if (user) await db.run('UPDATE users SET google_sub = ? WHERE id = ?', [claims.sub, user.id]); // link existing account
    else {
      const name = cleanText(claims.name || email.split('@')[0], 40);
      const { lastId } = await db.run('INSERT INTO users (email, name, google_sub) VALUES (?, ?, ?)', [email, name, claims.sub]);
      user = { id: lastId };
    }
  }
  await startSession(res, user.id);
  res.redirect('/' + safeNext(next));
}));

module.exports = { router, loadUser, requireUser };
