const app = require('./app');

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`Starsplit running at http://localhost:${port}`));

// let open SSE streams go and finish in-flight requests when the host stops us
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
});
