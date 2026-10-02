// Express app: security headers, static front end, JSON API, error handling.
const express = require('express');
const path = require('path');
const routes = require('./routes');
const { rateLimit } = require('./rate-limit');
const { HttpError } = require('./errors');

const app = express();
app.set('trust proxy', 1); // running behind a hosting proxy: use the real client IP
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m' }));
app.get('/healthz', (req, res) => res.json({ ok: true }));

const writeLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 300 });
app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : writeLimit(req, res, next)));
app.use('/api', routes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;
