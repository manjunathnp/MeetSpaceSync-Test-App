/* MeetSpaceSync v1.0.0 - deep QA suite.
   Boundary values, negative paths, permission matrix, overlap geometry,
   data integrity and adhoc inputs, exercised as both Administrator and
   Standard User. Run with: npm run deep                                  */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = Number(process.env.DEEP_PORT || 4397);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const TMP_DATA = path.join(os.tmpdir(), `mss-deep-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

function ok(condition, label, extra) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; failures.push(label); console.log('  FAIL  ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
function section(name) { console.log('\n' + name); }

async function call(pathname, options = {}) {
  const res = await fetch(BASE + pathname, options);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
}
const authed = (token, extra = {}) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...extra });
const fieldErrors = r => (r.body && r.body.error && r.body.error.details && r.body.error.details.fieldErrors) || {};
const code = r => (r.body && r.body.error && r.body.error.code) || '';

const pad2 = n => String(n).padStart(2, '0');
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_FILE: TMP_DATA }
  });
  const stop = () => { try { child.kill(); } catch { /* gone */ } };
  process.on('exit', stop);

  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/api/ping')).ok) break; } catch { /* waiting */ }
      await wait(100);
    }

    const signIn = async (username, password) => {
      const r = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      return r.body;
    };
    const admin = await signIn('admin', 'admin123');
    const user = await signIn('user', 'user123');
    const A = admin.token;
    const U = user.token;

    const TOMORROW = dateOffset(1);
    const base = { meetingTitle: 'Deep QA', blockId: 'VERTEX', floor: 1, roomId: 'VERTEX-F01-R01', bookingDate: TOMORROW, startClock: '10:00', endClock: '11:00', attendees: 2 };
    const post = (token, overrides) => call('/api/bookings', { ...authed(token), method: 'POST', body: JSON.stringify({ ...base, ...overrides }) });

    /* Rooms on a given floor, so each case can take an untouched Room. */
    const roomsOnFloor = async (blockId, floor) => (await call(`/api/rooms?blockId=${blockId}&floor=${floor}`, authed(A))).body;
    const f2 = await roomsOnFloor('VERTEX', 2);
    const f3 = await roomsOnFloor('VERTEX', 3);
    const f4 = await roomsOnFloor('VERTEX', 4);
    const f5 = await roomsOnFloor('VERTEX', 5);
    let cursor = 0;
    const freeRoom = pool => pool[cursor++ % pool.length];

    /* ------------------------------------------------------------ */
    section('Boundary values: title, notes, attendees, duration');
    let r = await post(A, { roomId: f2[0].id, floor: 2, meetingTitle: 'abc' });
    ok(r.status === 201, 'A 3 character Meeting Title is accepted', r.status);

    r = await post(A, { roomId: f2[1].id, floor: 2, meetingTitle: 'x'.repeat(80) });
    ok(r.status === 201, 'An 80 character Meeting Title is accepted', r.status);

    r = await post(A, { roomId: f2[2].id, floor: 2, meetingTitle: 'x'.repeat(81) });
    ok(fieldErrors(r).meetingTitle === 'Meeting Title cannot exceed 80 characters.', 'An 81 character Meeting Title is rejected', fieldErrors(r));

    r = await post(A, { roomId: f2[2].id, floor: 2, meetingTitle: 'ab' });
    ok(fieldErrors(r).meetingTitle === 'Meeting Title must contain at least 3 characters.', 'A 2 character Meeting Title is rejected', fieldErrors(r));

    r = await post(A, { roomId: f2[2].id, floor: 2, meetingTitle: '   ' });
    ok(fieldErrors(r).meetingTitle === 'Enter a Meeting Title.', 'A whitespace only Meeting Title is treated as empty', fieldErrors(r));

    r = await post(A, { roomId: f2[2].id, floor: 2, notes: 'n'.repeat(300) });
    ok(r.status === 201, 'A 300 character note is accepted', r.status);

    r = await post(A, { roomId: f2[3].id, floor: 2, notes: 'n'.repeat(301) });
    ok(fieldErrors(r).notes === 'Notes cannot exceed 300 characters.', 'A 301 character note is rejected', fieldErrors(r));

    r = await post(A, { roomId: f2[3].id, floor: 2, startClock: '09:00', endClock: '13:00' });
    ok(r.status === 201, 'A Booking of exactly 4 hours is accepted', r.status);

    r = await post(A, { roomId: f2[4].id, floor: 2, startClock: '09:00', endClock: '13:01' });
    ok(fieldErrors(r).endClock === 'Booking Duration cannot exceed 4 hours.', 'A Booking of 4 hours and 1 minute is rejected', fieldErrors(r));

    r = await post(A, { roomId: f2[4].id, floor: 2, startClock: '09:00', endClock: '09:01' });
    ok(r.status === 201, 'A one minute Booking is accepted', r.status);

    const capRoom = f3[0];
    r = await post(A, { roomId: capRoom.id, floor: 3, attendees: capRoom.capacity });
    ok(r.status === 201, `Attendees exactly at capacity (${capRoom.capacity}) is accepted`, r.status);

    r = await post(A, { roomId: f3[1].id, floor: 3, attendees: f3[1].capacity + 1 });
    ok(/supports up to/.test(fieldErrors(r).attendees || ''), 'Attendees one above capacity is rejected', fieldErrors(r));

    r = await post(A, { roomId: f3[1].id, floor: 3, attendees: 0 });
    ok(fieldErrors(r).attendees === 'Enter at least 1 Attendee.', 'Zero attendees is rejected', fieldErrors(r));

    r = await post(A, { roomId: f3[1].id, floor: 3, attendees: -5 });
    ok(fieldErrors(r).attendees === 'Enter at least 1 Attendee.', 'Negative attendees is rejected', fieldErrors(r));

    r = await post(A, { roomId: f3[1].id, floor: 3, attendees: 2.5 });
    ok(fieldErrors(r).attendees === 'Enter at least 1 Attendee.', 'A fractional attendee count is rejected', fieldErrors(r));

    /* ------------------------------------------------------------ */
    section('Overlap geometry against a 10:00 to 11:00 Booking');
    const overlapRoom = f4[0];
    r = await post(A, { roomId: overlapRoom.id, floor: 4, startClock: '10:00', endClock: '11:00' });
    ok(r.status === 201, 'The reference Booking is created', r.status);

    const overlap = (start, end) => post(A, { roomId: overlapRoom.id, floor: 4, startClock: start, endClock: end, meetingTitle: `Overlap ${start}` });

    r = await overlap('09:00', '10:00');
    ok(r.status === 201, 'A Booking ending exactly when the other starts is allowed', r.status);
    r = await overlap('11:00', '12:00');
    ok(r.status === 201, 'A Booking starting exactly when the other ends is allowed', r.status);
    r = await overlap('10:15', '10:45');
    ok(/already booked/.test(fieldErrors(r).roomId || ''), 'A Booking entirely inside the other is rejected', fieldErrors(r));
    r = await overlap('09:30', '12:30');
    ok(/already booked/.test(fieldErrors(r).roomId || ''), 'A Booking that fully contains the other is rejected', fieldErrors(r));
    r = await overlap('10:00', '11:00');
    ok(/already booked/.test(fieldErrors(r).roomId || ''), 'An identical slot is rejected', fieldErrors(r));
    r = await overlap('09:30', '10:30');
    ok(/already booked/.test(fieldErrors(r).roomId || ''), 'A Booking overlapping the start is rejected', fieldErrors(r));
    r = await overlap('10:30', '11:30');
    ok(/already booked/.test(fieldErrors(r).roomId || ''), 'A Booking overlapping the end is rejected', fieldErrors(r));

    r = await post(A, { roomId: f4[1].id, floor: 4, startClock: '10:00', endClock: '11:00' });
    ok(r.status === 201, 'The same slot in a different Room is allowed', r.status);
    r = await post(A, { roomId: overlapRoom.id, floor: 4, bookingDate: dateOffset(2), startClock: '10:00', endClock: '11:00' });
    ok(r.status === 201, 'The same slot on a different day is allowed', r.status);

    /* ------------------------------------------------------------ */
    section('Malformed and adhoc input');
    r = await post(A, { bookingDate: '2026-13-45' });
    ok(fieldErrors(r).bookingDate === 'Choose a valid Booking Date.', 'An impossible calendar date is rejected', fieldErrors(r));
    ok(fieldErrors(r).endClock === undefined && fieldErrors(r).startClock === undefined,
      'A bad date does not raise a misleading time error', fieldErrors(r));

    r = await post(A, { bookingDate: '2026-02-30' });
    ok(fieldErrors(r).bookingDate === 'Choose a valid Booking Date.', 'A day that does not exist in the month is rejected', fieldErrors(r));

    r = await post(A, { startClock: '99:99' });
    ok(fieldErrors(r).startClock === 'Choose a valid Start Time.', 'An out of range Start Time is reported against the Start Time', fieldErrors(r));
    ok(fieldErrors(r).bookingDate === undefined, 'An out of range time does not blame the Booking Date', fieldErrors(r));

    r = await post(A, { startClock: '24:00' });
    ok(fieldErrors(r).startClock === 'Choose a valid Start Time.', 'Hour 24 is rejected', fieldErrors(r));
    r = await post(A, { endClock: '10:60' });
    ok(fieldErrors(r).endClock === 'Choose a valid End Time.', 'Minute 60 is rejected', fieldErrors(r));

    r = await post(A, { roomId: 'NOT-A-ROOM' });
    ok(fieldErrors(r).roomId === 'Select an Available Room.', 'An unknown Room id is rejected', fieldErrors(r));
    r = await post(A, { blockId: 'NOWHERE' });
    ok(/does not belong/.test(fieldErrors(r).roomId || ''), 'A Room from another Building is rejected', fieldErrors(r));
    r = await post(A, { floor: 9 });
    ok(/does not belong/.test(fieldErrors(r).roomId || ''), 'A Room from another Floor is rejected', fieldErrors(r));

    r = await post(A, { bookingDate: dateOffset(-1) });
    ok(fieldErrors(r).startClock === 'Past Date or Time cannot be booked.', 'A past date is rejected', fieldErrors(r));

    r = await call('/api/bookings', { ...authed(A), method: 'POST', body: '{"meetingTitle":' });
    ok(code(r) === 'INVALID_JSON', 'A truncated JSON body is rejected', code(r));
    r = await call('/api/bookings', { ...authed(A), method: 'POST', body: '[]' });
    ok(code(r) === 'VALIDATION_ERROR', 'An array body is handled without crashing', code(r));
    r = await call('/api/bookings', { ...authed(A), method: 'POST', body: 'null' });
    ok(r.status === 400, 'A null body is handled without crashing', r.status);

    const xss = '<img src=x onerror=alert(1)>';
    r = await post(A, { roomId: f5[0].id, floor: 5, meetingTitle: xss, notes: '<script>alert(2)</script>' });
    ok(r.status === 201 && r.body.meetingTitle === xss, 'Script-like text is stored verbatim, for the UI to escape on render', r.status);
    const xssId = r.body.id;

    r = await post(A, { roomId: f5[1].id, floor: 5, meetingTitle: 'Unicode \u0915\u0928\u094d\u0928\u0921 \u4f1a\u8b70' });
    ok(r.status === 201 && /\u0915\u0928\u094d\u0928\u0921/.test(r.body.meetingTitle), 'A non-Latin Meeting Title round trips', r.status);

    /* ------------------------------------------------------------ */
    section('Permission matrix');
    const adminBooking = (await post(A, { roomId: f5[2].id, floor: 5, meetingTitle: 'Admin Owned' })).body;
    const userBooking = (await post(U, { roomId: f5[3].id, floor: 5, meetingTitle: 'User Owned' })).body;

    const matrix = [
      ['GET /rooms', U, () => call('/api/rooms', authed(U)), 200],
      ['GET /bookings', U, () => call('/api/bookings', authed(U)), 200],
      ['GET /blocks', U, () => call('/api/blocks', authed(U)), 200],
      ['GET /availability', U, () => call(`/api/availability?roomId=${f5[4].id}&bookingDate=${TOMORROW}&startClock=08:00&endClock=09:00`, authed(U)), 200],
      ['PATCH /rooms as user', U, () => call(`/api/rooms/${f5[4].id}`, { ...authed(U), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'x' }) }), 403],
      ['POST /reset as user', U, () => call('/api/reset', { ...authed(U), method: 'POST' }), 403],
      ['PUT another account Booking', U, () => call(`/api/bookings/${adminBooking.id}`, { ...authed(U), method: 'PUT', body: JSON.stringify({ ...base, roomId: f5[2].id, floor: 5, updateComment: 'Unauthorised edit attempt.' }) }), 403],
      ['DELETE another account Booking', U, () => call(`/api/bookings/${adminBooking.id}`, { ...authed(U), method: 'DELETE', body: JSON.stringify({ reason: 'x' }) }), 403],
      ['PUT own Booking', U, () => call(`/api/bookings/${userBooking.id}`, { ...authed(U), method: 'PUT', body: JSON.stringify({ ...base, roomId: f5[3].id, floor: 5, meetingTitle: 'User Owned v2', updateComment: 'Renamed after the planning call.' }) }), 200],
      ['PATCH /rooms as admin', A, () => call(`/api/rooms/${f5[4].id}`, { ...authed(A), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Deep QA' }) }), 200],
      ['PUT any Booking as admin', A, () => call(`/api/bookings/${userBooking.id}`, { ...authed(A), method: 'PUT', body: JSON.stringify({ ...base, roomId: f5[3].id, floor: 5, meetingTitle: 'Admin Edited', updateComment: 'Corrected on behalf of the owner.' }) }), 200]
    ];
    for (const [label, , run, expected] of matrix) {
      const res = await run();
      ok(res.status === expected, `${label} returns ${expected}`, { got: res.status, body: res.body && res.body.error });
    }

    r = await call(`/api/rooms/${f5[4].id}`, { ...authed(A), method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
    ok(r.status === 200, 'The Room used for the permission matrix is restored', r.status);

    /* ------------------------------------------------------------ */
    section('Data integrity');
    r = await call(`/api/bookings/${userBooking.id}`, { ...authed(U), method: 'DELETE', body: JSON.stringify({}) });
    ok(code(r) === 'VALIDATION_ERROR', 'A Standard User is also asked for a Cancellation Comment', { status: r.status, fields: fieldErrors(r) });

    r = await call(`/api/bookings/${userBooking.id}`, { ...authed(U), method: 'DELETE', body: JSON.stringify({ reason: 'No longer required.' }) });
    ok(r.status === 200 && r.body.status === 'CANCELLED', 'A Standard User cancels their own Booking with a comment', r.status);

    r = await call(`/api/bookings/${userBooking.id}`, { ...authed(U), method: 'PUT', body: JSON.stringify({ ...base, roomId: f5[3].id, floor: 5, updateComment: 'Trying to revive it.' }) });
    ok(code(r) === 'BOOKING_CANCELLED', 'A cancelled Booking cannot be edited back into life', { status: r.status, code: code(r) });

    r = await call(`/api/bookings/${userBooking.id}`, { ...authed(A), method: 'DELETE', body: JSON.stringify({ reason: 'Cancelling a second time.' }) });
    ok(code(r) === 'ALREADY_CANCELLED', 'A cancelled Booking cannot be cancelled twice', code(r));

    r = await post(U, { roomId: f5[3].id, floor: 5, meetingTitle: 'Reusing The Freed Slot' });
    ok(r.status === 201, 'The slot freed by a cancellation can be booked again', r.status);

    const inactiveRoom = f4[4];
    await call(`/api/rooms/${inactiveRoom.id}`, { ...authed(A), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Deep QA maintenance.' }) });
    r = await call(`/api/availability?roomId=${inactiveRoom.id}&bookingDate=${TOMORROW}&startClock=10:00&endClock=11:00`, authed(A));
    ok(r.body.available === false && r.body.message === 'This Meeting Room is inactive.',
      'Availability reports an inactive Room as unavailable rather than free', r.body);
    ok(r.body.roomStatus === 'INACTIVE', 'Availability reports the Room status', r.body.roomStatus);
    r = await post(A, { roomId: inactiveRoom.id, floor: 4, startClock: '15:00', endClock: '16:00' });
    ok(fieldErrors(r).roomId === 'This Meeting Room is inactive.', 'An inactive Room cannot be booked, matching the availability answer', fieldErrors(r));
    await call(`/api/rooms/${inactiveRoom.id}`, { ...authed(A), method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });

    r = await call(`/api/rooms/${overlapRoom.id}`, { ...authed(A), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Should be blocked.' }) });
    ok(code(r) === 'ROOM_HAS_FUTURE_BOOKINGS', 'A Room holding a future Booking cannot be deactivated', code(r));
    ok(r.body.error.details.bookings.every(b => b.meetingTitle && b.startTime),
      'The 409 carries enough detail for the dialog to list the Bookings', r.body.error.details.bookings);

    /* ------------------------------------------------------------ */
    section('Comment rule boundaries');
    const cBody = { ...base, roomId: f2[0].id, floor: 2, meetingTitle: 'Comment Rule', startClock: '07:00', endClock: '08:00' };
    r = await post(A, cBody);
    const cId = r.body.id;
    for (const [value, expected, label] of [
      ['', 'Reason for Update is required.', 'an empty reason'],
      ['    ', 'Reason for Update is required.', 'a whitespace only reason'],
      ['abcd', 'Reason for Update must contain at least 5 characters.', 'a four character reason'],
      ['  ab  ', 'Reason for Update must contain at least 5 characters.', 'a padded short reason']
    ]) {
      const res = await call(`/api/bookings/${cId}`, { ...authed(A), method: 'PUT', body: JSON.stringify({ ...cBody, updateComment: value }) });
      ok(fieldErrors(res).updateComment === expected, `Update rejects ${label}`, fieldErrors(res));
    }
    r = await call(`/api/bookings/${cId}`, { ...authed(A), method: 'PUT', body: JSON.stringify({ ...cBody, updateComment: 'abcde' }) });
    ok(r.status === 200, 'Exactly five characters is accepted', r.status);
    r = await call(`/api/bookings/${cId}`, { ...authed(A), method: 'PUT', body: JSON.stringify({ ...cBody, updateComment: '  padded reason  ' }) });
    ok(r.status === 200 && r.body.updateComment === 'padded reason', 'A reason is stored trimmed', r.body.updateComment);
    for (const [value, expected, label] of [
      ['', 'Cancellation Comment is required.', 'an empty comment'],
      ['four', 'Cancellation Comment must contain at least 5 characters.', 'a four character comment']
    ]) {
      const res = await call(`/api/bookings/${cId}`, { ...authed(A), method: 'DELETE', body: JSON.stringify({ reason: value }) });
      ok(fieldErrors(res).reason === expected, `Cancellation rejects ${label}`, fieldErrors(res));
    }
    r = await call(`/api/bookings/${cId}`, { ...authed(A), method: 'DELETE', body: JSON.stringify({ reason: 'Cancelled after review.' }) });
    ok(r.status === 200, 'A valid Cancellation Comment is accepted', r.status);
    ok(r.body.auditTrail.map(e => e.action).join(',') === 'CREATED,UPDATED,UPDATED,CANCELLED',
      'The trail records every step in order', r.body.auditTrail.map(e => e.action));

    /* ------------------------------------------------------------ */
    section('Concurrency');
    const raceRoom = f3[4];
    const [ra, rb] = await Promise.all([
      post(A, { roomId: raceRoom.id, floor: 3, startClock: '16:00', endClock: '17:00', meetingTitle: 'Race A' }),
      post(U, { roomId: raceRoom.id, floor: 3, startClock: '16:00', endClock: '17:00', meetingTitle: 'Race B' })
    ]);
    const statuses = [ra.status, rb.status].sort();
    ok(statuses[0] === 201 && statuses[1] === 400,
      'Two simultaneous Bookings for one slot produce exactly one winner', statuses);
    const held = (await call(`/api/bookings?roomId=${raceRoom.id}&status=BOOKED`, authed(A))).body;
    ok(held.filter(b => b.startTime.includes('T')).length >= 1 && held.length === 1,
      'Only one Booking survives the race', held.length);

    /* ------------------------------------------------------------ */
    section('Auth edge cases');
    const cases = [
      ['a token with no Bearer prefix', { Authorization: A }],
      ['an empty Bearer value', { Authorization: 'Bearer ' }],
      ['a token with a swapped signature', { Authorization: 'Bearer ' + A.split('.').slice(0, 2).join('.') + '.deadbeef' }],
      ['a completely malformed token', { Authorization: 'Bearer not.a.token' }],
      ['a Basic header where Bearer is expected', { Authorization: 'Basic ' + Buffer.from('admin:admin123').toString('base64') }]
    ];
    for (const [label, headers] of cases) {
      const res = await call('/api/rooms', { headers });
      ok(res.status === 401 && code(res) === 'UNAUTHORIZED', `Rejected: ${label}`, res.status);
    }
    r = await call('/api/auth/apikey', { method: 'POST' });
    ok(r.status === 405, 'POST to the API key endpoint returns 405', r.status);
    r = await call('/api/auth/basic', { method: 'POST' });
    ok(r.status === 405, 'POST to the Basic endpoint returns 405', r.status);
    r = await call('/api/auth/basic', { headers: { Authorization: 'Basic not-base64!!' } });
    ok(r.status === 401, 'A non base64 Basic header is rejected without crashing', r.status);

    /* ------------------------------------------------------------ */
    section('Read consistency');
    r = await call('/api/bookings', authed(U));
    const all = r.body;
    ok(all.some(b => b.createdByName === 'Administrator') && all.some(b => b.createdByName === 'Standard User'),
      'Both accounts see the shared schedule');
    r = await call(`/api/bookings?roomId=${overlapRoom.id}`, authed(U));
    ok(r.body.every(b => b.roomId === overlapRoom.id), 'Bookings can be filtered by Room', r.body.length);
    r = await call('/api/bookings?status=CANCELLED', authed(U));
    ok(r.body.every(b => b.status === 'CANCELLED'), 'Bookings can be filtered by status', r.body.length);

    r = await call(`/api/bookings/${xssId}`, authed(U));
    ok(r.body.meetingTitle === xss, 'A stored Booking round trips unchanged through GET', r.status);

    r = await call('/api/overview');
    const counts = r.body;
    const roomsNow = (await call('/api/rooms', authed(A))).body;
    ok(counts.rooms === roomsNow.length, 'The overview Room count matches the Room list', { counts, len: roomsNow.length });
    ok(counts.activeRooms === roomsNow.filter(x => x.status === 'ACTIVE').length, 'The overview active count is consistent', counts);

    /* ------------------------------------------------------------ */
    section('Reset restores a clean slate');
    r = await call('/api/reset', { ...authed(A), method: 'POST' });
    ok(r.status === 200 && r.body.rooms === 125 && r.body.bookings === 0, 'Reset restores 125 Rooms and no Bookings', r.body);
    r = await call('/api/rooms?status=INACTIVE', authed(A));
    ok(r.body.length === 0, 'Reset reactivates every Meeting Room', r.body.length);
    r = await call('/api/bookings', authed(A));
    ok(r.body.length === 0, 'Reset clears every Booking', r.body.length);

  } catch (e) {
    failed++;
    failures.push('Suite crashed: ' + e.message);
    console.log('\nSuite crashed: ' + e.stack);
  } finally {
    stop();
    try { fs.existsSync(TMP_DATA) && fs.unlinkSync(TMP_DATA); } catch { /* ignore */ }
  }

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`Deep QA: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(failed ? 1 : 0);
})();
