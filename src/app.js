// Express app: security headers, static front end, JSON API, error handling.
const express = require('express');
const path = require('path');
const routes = require('./routes');
const { rateLimit } = require('./rate-limit');
const auth = require('./auth');
const { HttpError } = require('./errors');

const app = express();
app.set('trust proxy', 1); // running behind a hosting proxy: use the real client IP
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});
app.use(express.json({ limit: '20kb' }));
// Front-end files are unbundled ES modules, so a browser must never mix old and new
// versions after a deploy: always revalidate (cheap, thanks to ETags) instead of caching blindly.
const fresh = { setHeaders: (res) => res.set('Cache-Control', 'no-cache') };
app.use(express.static(path.join(__dirname, '..', 'public'), fresh));
// the ledger maths, shared with the browser so the time machine replays exactly what the server computes
app.use('/shared', express.static(path.join(__dirname, 'shared'), fresh));
app.get('/healthz', (req, res) => res.json({ ok: true }));

const writeLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 300 });
app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : writeLimit(req, res, next)));
app.use('/api', auth.loadUser);
app.use('/api/auth', auth.router);
app.use('/api', auth.requireUser, routes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;
