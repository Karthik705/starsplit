// The money logic lives in shared/ledger.mjs so the browser can run the exact same code
// (the time machine replays the ledger client-side). This re-exports it for CommonJS callers.
module.exports = require('./shared/ledger.mjs');
