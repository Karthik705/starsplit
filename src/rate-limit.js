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

module.exports = { rateLimit };
