/** Wrap an async route handler so rejected promises reach Express's error handler. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { h };
