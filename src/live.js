// Live sync over server-sent events: one "room" of open responses per group code.
const rooms = new Map();

function notify(code) {
  for (const res of rooms.get(code.toUpperCase()) || []) res.write('data: update\n\n');
}

function subscribe(code, req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(': connected\n\n');
  if (!rooms.has(code)) rooms.set(code, new Set());
  rooms.get(code).add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(beat);
    rooms.get(code)?.delete(res);
    if (!rooms.get(code)?.size) rooms.delete(code);
  });
}

module.exports = { notify, subscribe };
