/* MeetSpaceSync v1.0.0 - smoke and sanity suite.
   A fast confidence check that the build is worth testing further.
   Run with: npm run smoke                                              */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = Number(process.env.SMOKE_PORT || 4398);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const TMP_DATA = path.join(os.tmpdir(), `mss-smoke-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));

function ok(condition, label, extra) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
}
async function call(pathname, options = {}) {
  const res = await fetch(BASE + pathname, options);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
function pad2(n) { return String(n).padStart(2, '0'); }
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_FILE: TMP_DATA }
  });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/api/ping')).ok) break; } catch { /* waiting */ }
      await wait(100);
    }

    console.log('\nSmoke and sanity');
    let r = await call('/api/ping');
    ok(r.status === 200 && r.body.status === 'UP', 'The server answers on /api/ping', r.body);

    for (const route of ['/', '/docs', '/openapi.json', '/app.js', '/styles.css']) {
      const res = await fetch(BASE + route);
      ok(res.ok, `${route} is served`, res.status);
    }

    r = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    ok(r.status === 200 && !!r.body.token, 'The admin account signs in', r.status);
    const token = r.body.token;
    const auth = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };

    r = await call('/api/rooms', auth);
    ok(r.status === 200 && r.body.length === 125, 'All 125 Meeting Rooms load', r.body.length);

    r = await call('/api/blocks', auth);
    ok(r.status === 200 && r.body.length === 3, 'All 3 Buildings load', r.body.length);

    const booking = {
      meetingTitle: 'Smoke Check', blockId: 'VERTEX', floor: 1, roomId: 'VERTEX-F01-R01',
      bookingDate: tomorrow(), startClock: '08:00', endClock: '09:00', attendees: 2
    };
    r = await call('/api/bookings', { ...auth, method: 'POST', body: JSON.stringify(booking) });
    ok(r.status === 201, 'A Booking can be created', r.status);
    const id = r.body.id;

    r = await call(`/api/availability?roomId=VERTEX-F01-R01&bookingDate=${tomorrow()}&startClock=08:30&endClock=09:30`, auth);
    ok(r.status === 200 && r.body.available === false, 'The availability check spots the clash', r.body && r.body.available);

    r = await call(`/api/bookings/${id}`, { ...auth, method: 'DELETE', body: JSON.stringify({ reason: 'Smoke test cleanup.' }) });
    ok(r.status === 200 && r.body.status === 'CANCELLED', 'A Booking can be cancelled', r.status);

    r = await call('/api/reset', { ...auth, method: 'POST' });
    ok(r.status === 200, 'The demo data resets', r.status);
  } finally {
    try { child.kill(); } catch { /* already gone */ }
    try { fs.existsSync(TMP_DATA) && fs.unlinkSync(TMP_DATA); } catch { /* ignore */ }
  }

  console.log(`\n${'-'.repeat(48)}`);
  console.log(`Smoke: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
