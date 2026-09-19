/* MeetSpaceSync v1.0.0 - API regression suite.
   Starts the server on a spare port, exercises every endpoint and business
   rule, then reports a pass/fail summary. Run with: npm test               */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.env.TEST_PORT || 4399);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const TMP_DATA = path.join(os.tmpdir(), `mss-test-data-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label, extra) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; failures.push(label + (extra ? ' -> ' + JSON.stringify(extra) : '')); console.log('  FAIL  ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
}
function section(name) { console.log('\n' + name); }
const wait = ms => new Promise(r => setTimeout(r, ms));

async function call(pathname, options = {}) {
  const res = await fetch(BASE + pathname, options);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
}
function authed(token, extra = {}) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(extra.headers || {}) }, ...extra };
}
function pad2(n) { return String(n).padStart(2, '0'); }
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_FILE: TMP_DATA }
  });

  const stop = () => { try { child.kill(); } catch { /* already gone */ } };
  process.on('exit', stop);

  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/api/ping')).ok) break; } catch { /* not up yet */ }
      await wait(100);
    }

    /* ---------------------------------------------------------------- */
    section('Health and open endpoints');
    let r = await call('/api/ping');
    ok(r.status === 200 && r.body.app === 'MeetSpaceSync', 'GET /api/ping returns 200 and the app name', r.body);
    ok(r.body.version === '1.0.0', 'GET /api/ping reports version 1.0.0', r.body.version);
    ok(r.body.rooms === 125, 'GET /api/ping reports 125 Meeting Rooms', r.body.rooms);

    r = await call('/api/overview');
    ok(r.status === 200 && r.body.buildings === 3 && r.body.floors === 25, 'GET /api/overview returns 3 Buildings and 25 Floors', r.body);

    r = await call('/api/nope');
    ok(r.status === 404 && r.body.error.code === 'ROUTE_NOT_FOUND', 'Unknown route returns 404 ROUTE_NOT_FOUND', r.body);

    /* ---------------------------------------------------------------- */
    section('Authentication');
    r = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
    ok(r.status === 401 && r.body.error.code === 'INVALID_CREDENTIALS', 'Bad password returns 401 INVALID_CREDENTIALS', r.body);

    r = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
    ok(r.status === 400 && r.body.error.code === 'INVALID_JSON', 'Malformed JSON returns 400 INVALID_JSON', r.body);

    r = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    ok(r.status === 200 && !!r.body.token, 'Admin login returns a token', r.status);
    ok(r.body.user && r.body.user.id === 'USR-ADMIN' && r.body.user.role === 'ADMIN', 'Admin login response carries id and role', r.body.user);
    const adminToken = r.body.token;

    r = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user', password: 'user123' }) });
    ok(r.status === 200 && r.body.user.role === 'USER', 'User login returns the USER role', r.body.user);
    const userToken = r.body.token;
    const userId = r.body.user.id;

    r = await call('/api/auth/me', authed(adminToken));
    ok(r.status === 200 && r.body.sub === 'USR-ADMIN', 'GET /api/auth/me returns sub for the signed-in account', r.body);
    ok(r.body.id === 'USR-ADMIN', 'Token payload also carries id, so ownership checks work on both shapes', r.body.id);

    r = await call('/api/blocks');
    ok(r.status === 401 && r.body.error.code === 'UNAUTHORIZED', 'Secured endpoint without a token returns 401', r.body);

    r = await call('/api/blocks', authed('tampered.token.value'));
    ok(r.status === 401, 'Tampered token is rejected', r.status);

    r = await call('/api/auth/apikey');
    ok(r.status === 401 && r.body.error.code === 'MISSING_API_KEY', 'API key endpoint without the header returns 401 MISSING_API_KEY', r.body);
    r = await call('/api/auth/apikey', { headers: { 'X-API-Key': 'wrong' } });
    ok(r.status === 401 && r.body.error.code === 'INVALID_API_KEY', 'Wrong API key returns 401 INVALID_API_KEY', r.body);
    r = await call('/api/auth/apikey', { headers: { 'X-API-Key': 'meetspacesync-key-2026' } });
    ok(r.status === 200 && r.body.authenticated === true, 'Correct API key is accepted', r.body);

    r = await call('/api/auth/basic');
    ok(r.status === 401 && r.headers.get('www-authenticate') === 'Basic realm="MeetSpaceSync"', 'Basic endpoint challenges when no credentials are sent', r.status);
    r = await call('/api/auth/basic', { headers: { Authorization: 'Basic ' + Buffer.from('meetspace:basic123').toString('base64') } });
    ok(r.status === 200 && r.body.method === 'basic', 'Correct Basic credentials are accepted', r.body);
    r = await call('/api/auth/basic', { headers: { Authorization: 'Basic ' + Buffer.from('meetspace:nope').toString('base64') } });
    ok(r.status === 401 && r.body.error.code === 'INVALID_BASIC_AUTH', 'Wrong Basic password returns 401 INVALID_BASIC_AUTH', r.body);

    /* ---------------------------------------------------------------- */
    section('Buildings and Meeting Rooms');
    r = await call('/api/blocks', authed(userToken));
    ok(r.status === 200 && r.body.length === 3, 'GET /api/blocks returns 3 Buildings for a standard user', r.body.length);

    r = await call('/api/rooms', authed(userToken));
    ok(r.status === 200 && r.body.length === 125, 'GET /api/rooms returns all 125 Meeting Rooms', r.body.length);

    r = await call('/api/rooms?blockId=APEX', authed(userToken));
    ok(r.body.length === 25 && r.body.every(x => x.blockId === 'APEX'), 'Filter by blockId returns only Apex Rooms', r.body.length);

    r = await call('/api/rooms?blockId=VERTEX&floor=1', authed(userToken));
    ok(r.body.length === 5 && r.body.every(x => x.floor === 1), 'Filter by Building and Floor returns 5 Rooms', r.body.length);

    r = await call('/api/rooms?status=INACTIVE', authed(userToken));
    ok(r.body.length === 0, 'No Meeting Room is inactive in the seeded data', r.body.length);

    r = await call('/api/rooms/VERTEX-F01-R01', authed(userToken));
    ok(r.status === 200 && r.body.name === 'Nova' && r.body.code === 'V-01-01', 'GET a single Meeting Room returns Nova with code V-01-01', r.body);

    r = await call('/api/rooms/NOPE', authed(userToken));
    ok(r.status === 404 && r.body.error.code === 'ROOM_NOT_FOUND', 'Unknown Meeting Room returns 404 ROOM_NOT_FOUND', r.body);

    /* ---------------------------------------------------------------- */
    section('Booking validation');
    const tomorrow = dateOffset(1);
    const yesterday = dateOffset(-1);
    const validBody = {
      meetingTitle: 'Sprint Planning',
      blockId: 'VERTEX', floor: 1, roomId: 'VERTEX-F01-R01',
      bookingDate: tomorrow, startClock: '10:00', endClock: '11:00',
      attendees: 4, notes: 'Bring the sprint board.'
    };

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({}) });
    ok(r.status === 400 && r.body.error.code === 'VALIDATION_ERROR', 'Empty body returns 400 VALIDATION_ERROR', r.status);
    ok(r.body.error.details.fieldErrors.bookingDate === 'Choose a valid Booking Date.', 'Missing date produces the documented bookingDate message', r.body.error.details.fieldErrors);
    ok(Object.keys(r.body.error.details.fieldErrors).length >= 7, 'Every missing required field is reported at once', Object.keys(r.body.error.details.fieldErrors));

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, meetingTitle: 'AB' }) });
    ok(r.body.error.details.fieldErrors.meetingTitle === 'Meeting Title must contain at least 3 characters.', 'Short title is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, meetingTitle: 'x'.repeat(81) }) });
    ok(!!r.body.error.details.fieldErrors.meetingTitle, 'Title longer than 80 characters is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, bookingDate: yesterday }) });
    ok(!!r.body.error.details.fieldErrors.startClock, 'A past Booking Date is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, endClock: '09:00' }) });
    ok(r.body.error.details.fieldErrors.endClock === 'End Time must be later than Start Time.', 'End before start is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, endClock: '16:00' }) });
    ok(r.body.error.details.fieldErrors.endClock === 'Booking Duration cannot exceed 4 hours.', 'Duration over 4 hours is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, attendees: 999 }) });
    ok(/supports up to/.test(r.body.error.details.fieldErrors.attendees || ''), 'Attendees above Room capacity is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, attendees: 0 }) });
    ok(r.body.error.details.fieldErrors.attendees === 'Enter at least 1 Attendee.', 'Zero attendees is rejected', r.body.error.details.fieldErrors);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, floor: 2 }) });
    ok(/does not belong/.test(r.body.error.details.fieldErrors.roomId || ''), 'Room that does not match the Building and Floor is rejected', r.body.error.details.fieldErrors);

    /* ---------------------------------------------------------------- */
    section('Booking lifecycle');
    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify(validBody) });
    ok(r.status === 201 && r.body.status === 'BOOKED', 'A valid Booking is created with 201', r.status);
    ok(r.body.roomName === 'Nova' && r.body.roomCode === 'V-01-01', 'Booking snapshots the Room name and code', { n: r.body.roomName, c: r.body.roomCode });
    ok(r.body.createdBy === userId, 'Booking records the creating account', r.body.createdBy);
    const bookingId = r.body.id;

    r = await call(`/api/bookings/${bookingId}`, authed(userToken));
    ok(r.status === 200 && r.body.id === bookingId, 'GET a single Booking returns it', r.status);

    section('Overlap and availability');
    r = await call(`/api/availability?roomId=VERTEX-F01-R01&bookingDate=${tomorrow}&startClock=10:30&endClock=11:30`, authed(userToken));
    ok(r.status === 200 && r.body.available === false, 'Availability reports an overlapping slot as unavailable', r.body);
    ok(r.body.conflicts.length === 1 && r.body.conflicts[0].meetingTitle === 'Sprint Planning', 'Availability names the clashing Booking', r.body.conflicts);
    ok(r.body.message === 'Nova is already booked during this time.', 'Availability message matches the UI wording', r.body.message);

    r = await call(`/api/availability?roomId=VERTEX-F01-R01&bookingDate=${tomorrow}&startClock=12:00&endClock=13:00`, authed(userToken));
    ok(r.body.available === true, 'A free slot is reported as available', r.body);

    r = await call(`/api/availability?roomId=VERTEX-F01-R01&bookingDate=${tomorrow}&startClock=11:00&endClock=12:00`, authed(userToken));
    ok(r.body.available === true, 'A slot starting exactly when another ends is available', r.body);

    r = await call(`/api/availability?roomId=VERTEX-F01-R01&bookingDate=${tomorrow}&startClock=10:30&endClock=11:30&ignoreBookingId=${bookingId}`, authed(userToken));
    ok(r.body.available === true, 'ignoreBookingId excludes the Booking being edited', r.body);

    r = await call('/api/availability?roomId=VERTEX-F01-R01&bookingDate=bad&startClock=10:00&endClock=11:00', authed(userToken));
    ok(r.status === 400 && r.body.error.details.fieldErrors.bookingDate === 'Choose a valid Booking Date.', 'Availability validates the date the same way', r.body);

    r = await call('/api/bookings', { ...authed(adminToken), method: 'POST', body: JSON.stringify({ ...validBody, meetingTitle: 'Clashing Review', startClock: '10:30', endClock: '11:30' }) });
    ok(r.status === 400 && r.body.error.details.fieldErrors.roomId === 'Nova is already booked during this time.', 'Double booking the same Room is refused', r.body.error.details);

    r = await call('/api/bookings', { ...authed(adminToken), method: 'POST', body: JSON.stringify({ ...validBody, meetingTitle: 'Parallel Session', roomId: 'VERTEX-F01-R02' }) });
    ok(r.status === 201, 'The same slot in a different Room is allowed', r.status);
    const adminBookingId = r.body.id;

    /* ---------------------------------------------------------------- */
    section('Permissions');
    r = await call(`/api/bookings/${adminBookingId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify({ ...validBody, roomId: 'VERTEX-F01-R02', meetingTitle: 'Hijack Attempt', updateComment: 'Attempting an unauthorised edit.' }) });
    ok(r.status === 403 && r.body.error.code === 'FORBIDDEN', 'A user cannot update a Booking created by the admin', r.body);

    r = await call(`/api/bookings/${adminBookingId}`, { ...authed(userToken), method: 'DELETE', body: JSON.stringify({ reason: 'nope' }) });
    ok(r.status === 403, 'A user cannot cancel a Booking created by the admin', r.status);

    r = await call(`/api/bookings/${bookingId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify({ ...validBody, meetingTitle: 'Sprint Planning Revised', attendees: 6, updateComment: 'Two more people joining the sprint review.' }) });
    ok(r.status === 200 && r.body.meetingTitle === 'Sprint Planning Revised' && r.body.attendees === 6, 'A user can update their own Booking', r.status);
    ok(!!r.body.updatedAt && !!r.body.updateComment, 'An update records the audit fields', { u: r.body.updatedAt, c: r.body.updateComment });

    r = await call(`/api/bookings/${bookingId}`, { ...authed(adminToken), method: 'PUT', body: JSON.stringify({ ...validBody, meetingTitle: 'Admin Edited Meeting', attendees: 5, updateComment: 'Reduced the attendee count after a headcount check.' }) });
    ok(r.status === 200, 'An admin can update any Booking', r.status);

    r = await call('/api/reset', { ...authed(userToken), method: 'POST' });
    ok(r.status === 403 && r.body.error.code === 'FORBIDDEN', 'A user cannot reset the demo data', r.body);

    r = await call('/api/rooms/VERTEX-F01-R01', { ...authed(userToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'x' }) });
    ok(r.status === 403, 'A user cannot change a Meeting Room status', r.status);

    /* ---------------------------------------------------------------- */
    section('Room deactivation rules');
    r = await call('/api/rooms/VERTEX-F01-R01', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Projector replacement.' }) });
    ok(r.status === 409 && r.body.error.code === 'ROOM_HAS_FUTURE_BOOKINGS', 'A Room with a future Booking cannot be deactivated', r.body.error.code);
    ok(Array.isArray(r.body.error.details.bookings) && r.body.error.details.bookings.length === 1, 'The 409 lists the blocking Bookings for the dialog', r.body.error.details);

    r = await call('/api/rooms/VERTEX-F01-R03', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE' }) });
    ok(r.status === 400 && r.body.error.details.fieldErrors.reason === 'Deactivation Comment is required.', 'Deactivation without a comment is refused', r.body.error.details);

    r = await call('/api/rooms/VERTEX-F01-R03', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'SLEEPING' }) });
    ok(r.status === 400, 'An unknown status value is refused', r.status);

    r = await call('/api/rooms/VERTEX-F01-R03', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Electrical maintenance.' }) });
    ok(r.status === 200 && r.body.status === 'INACTIVE' && r.body.deactivationComment === 'Electrical maintenance.', 'A free Room deactivates with a comment', r.body.status);

    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify({ ...validBody, meetingTitle: 'Into An Inactive Room', roomId: 'VERTEX-F01-R03', startClock: '14:00', endClock: '15:00' }) });
    ok(r.body.error.details.fieldErrors.roomId === 'This Meeting Room is inactive.', 'An inactive Room cannot be booked', r.body.error.details);

    r = await call('/api/rooms/VERTEX-F01-R03', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
    ok(r.status === 200 && r.body.status === 'ACTIVE' && r.body.deactivationComment === '', 'Reactivation clears the deactivation comment', r.body);

    /* ---------------------------------------------------------------- */
    section('Cancellation rules');
    r = await call(`/api/bookings/${adminBookingId}`, { ...authed(adminToken), method: 'DELETE', body: JSON.stringify({}) });
    ok(r.status === 400 && r.body.error.details.fieldErrors.reason, 'An admin must supply a Cancellation Comment', r.body.error.details);

    r = await call(`/api/bookings/${adminBookingId}`, { ...authed(adminToken), method: 'DELETE', body: JSON.stringify({ reason: 'Room closed for maintenance.' }) });
    ok(r.status === 200 && r.body.status === 'CANCELLED' && r.body.cancellationComment === 'Room closed for maintenance.', 'An admin cancellation stores the comment', r.body.status);

    r = await call(`/api/bookings/${adminBookingId}`, { ...authed(adminToken), method: 'DELETE', body: JSON.stringify({ reason: 'again' }) });
    ok(r.status === 409 && r.body.error.code === 'ALREADY_CANCELLED', 'Cancelling twice returns 409 ALREADY_CANCELLED', r.body);

    r = await call(`/api/bookings/${bookingId}`, { ...authed(userToken), method: 'DELETE', body: JSON.stringify({}) });
    ok(r.status === 400 && r.body.error.details.fieldErrors.reason === 'Cancellation Comment is required.', 'A Standard User must also supply a Cancellation Comment', r.body.error.details);

    r = await call(`/api/bookings/${bookingId}`, { ...authed(userToken), method: 'DELETE', body: JSON.stringify({ reason: 'Team no longer needs the slot.' }) });
    ok(r.status === 200 && r.body.cancellationComment === 'Team no longer needs the slot.', 'A user cancels their own Booking with a comment', r.body.cancellationComment);

    r = await call(`/api/availability?roomId=VERTEX-F01-R01&bookingDate=${tomorrow}&startClock=10:00&endClock=11:00`, authed(userToken));
    ok(r.body.available === true, 'A cancelled Booking frees the slot again', r.body);

    r = await call('/api/rooms/VERTEX-F01-R01', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Now free to deactivate.' }) });
    ok(r.status === 200, 'The Room deactivates once its Booking is cancelled', r.status);
    await call('/api/rooms/VERTEX-F01-R01', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });

    r = await call('/api/bookings?status=CANCELLED', authed(userToken));
    ok(r.status === 200 && r.body.length === 2 && r.body.every(b => b.status === 'CANCELLED'), 'Bookings can be filtered by status', r.body.length);

    r = await call('/api/bookings/BKG-DOES-NOT-EXIST', { ...authed(adminToken), method: 'DELETE', body: JSON.stringify({ reason: 'x' }) });
    ok(r.status === 404 && r.body.error.code === 'BOOKING_NOT_FOUND', 'An unknown Booking id returns 404', r.body);

    /* ---------------------------------------------------------------- */
    section('Mandatory comments and the audit trail');
    const auditBody = { ...validBody, roomId: 'APEX-F01-R01', blockId: 'APEX', floor: 1, meetingTitle: 'Audit Trail Check', startClock: '09:00', endClock: '10:00' };
    r = await call('/api/bookings', { ...authed(userToken), method: 'POST', body: JSON.stringify(auditBody) });
    ok(r.status === 201, 'A Booking is created for the audit checks', r.status);
    const auditId = r.body.id;
    ok(Array.isArray(r.body.auditTrail) && r.body.auditTrail.length === 1, 'Creating a Booking opens its audit trail', r.body.auditTrail);
    ok(r.body.auditTrail[0].action === 'CREATED' && r.body.auditTrail[0].byName === 'Standard User', 'The opening entry records who created it', r.body.auditTrail[0]);

    r = await call(`/api/bookings/${auditId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify(auditBody) });
    ok(r.status === 400 && r.body.error.details.fieldErrors.updateComment === 'Reason for Update is required.', 'An update without a reason is refused', r.body.error.details);

    r = await call(`/api/bookings/${auditId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify({ ...auditBody, updateComment: 'x' }) });
    ok(r.body.error.details.fieldErrors.updateComment === 'Reason for Update must contain at least 5 characters.', 'A one character reason is refused', r.body.error.details);

    r = await call(`/api/bookings/${auditId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify({ ...auditBody, updateComment: '      ' }) });
    ok(r.body.error.details.fieldErrors.updateComment === 'Reason for Update is required.', 'A whitespace only reason is refused', r.body.error.details);

    r = await call(`/api/bookings/${auditId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify({ ...auditBody, updateComment: 'n'.repeat(301) }) });
    ok(/cannot exceed 300/.test(r.body.error.details.fieldErrors.updateComment || ''), 'An over long reason is refused', r.body.error.details);

    r = await call(`/api/bookings/${auditId}`, { ...authed(userToken), method: 'PUT', body: JSON.stringify({ ...auditBody, attendees: 3, updateComment: 'First edit reason' }) });
    ok(r.status === 200 && r.body.auditTrail.length === 2, 'A valid update appends to the trail', r.body.auditTrail.length);

    r = await call(`/api/bookings/${auditId}`, { ...authed(adminToken), method: 'PUT', body: JSON.stringify({ ...auditBody, attendees: 4, updateComment: 'Second edit reason' }) });
    ok(r.body.auditTrail.length === 3, 'A second update appends again', r.body.auditTrail.length);
    ok(r.body.auditTrail[1].comment === 'First edit reason', 'The earlier reason is still there after a later edit', r.body.auditTrail.map(e => e.comment));
    ok(r.body.auditTrail[2].comment === 'Second edit reason' && r.body.auditTrail[2].byName === 'Administrator', 'The latest entry records the Administrator', r.body.auditTrail[2]);

    r = await call(`/api/bookings/${auditId}`, { ...authed(adminToken), method: 'DELETE', body: JSON.stringify({ reason: 'Project was shelved.' }) });
    ok(r.body.auditTrail.length === 4 && r.body.auditTrail[3].action === 'CANCELLED', 'Cancelling appends a final entry', r.body.auditTrail.map(e => e.action));
    ok(r.body.auditTrail.every(e => e.at && e.byName && e.action), 'Every entry records an action, an author and a timestamp', r.body.auditTrail);

    r = await call('/api/rooms/APEX-F04-R01', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'ac' }) });
    ok(r.body.error.details.fieldErrors.reason === 'Deactivation Comment must contain at least 5 characters.', 'A short Deactivation Comment is refused', r.body.error.details);

    r = await call('/api/rooms/APEX-F04-R01', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE', reason: 'Air conditioning repair.' }) });
    ok(r.status === 200 && r.body.auditTrail.length === 1 && r.body.auditTrail[0].action === 'DEACTIVATED', 'Deactivating a Room opens its trail', r.body.auditTrail);

    r = await call('/api/rooms/APEX-F04-R01', { ...authed(adminToken), method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
    ok(r.status === 200, 'Activating a Room needs no comment', r.status);
    ok(r.body.auditTrail.length === 2 && r.body.auditTrail[1].action === 'ACTIVATED', 'Activating still appends an entry', r.body.auditTrail);
    ok(r.body.auditTrail[0].comment === 'Air conditioning repair.', 'Reactivation keeps the reason the Room was taken out of service', r.body.auditTrail[0]);
    ok(r.body.deactivationComment === '', 'The current deactivation reason is cleared once the Room is back', r.body.deactivationComment);

    /* ---------------------------------------------------------------- */
    section('Demo data reset');
    r = await call('/api/reset', { ...authed(adminToken), method: 'POST' });
    ok(r.status === 200 && r.body.rooms === 125 && r.body.bookings === 0, 'Admin reset restores 125 Rooms and clears Bookings', r.body);
    r = await call('/api/bookings', authed(adminToken));
    ok(r.body.length === 0, 'No Bookings remain after a reset', r.body.length);

    /* ---------------------------------------------------------------- */
    section('Static assets and specification');
    for (const [route, label] of [['/', 'the UI'], ['/docs', 'the API Docs'], ['/docs.html', 'the API Docs by file name'], ['/openapi.json', 'the specification'], ['/app.js', 'the application script'], ['/styles.css', 'the stylesheet'], ['/sample-meeting-rooms.csv', 'the download sample']]) {
      const res = await fetch(BASE + route);
      ok(res.ok, `Static route ${route} serves ${label}`, res.status);
    }

    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'openapi.json'), 'utf8'));
    const bookingSchema = spec.components.schemas.Booking.properties;
    ok(bookingSchema.bookingDate.example !== undefined, 'The specification gives bookingDate a concrete example', bookingSchema.bookingDate);
    ok(bookingSchema.bookingDate['x-dynamic'] === 'tomorrow', 'bookingDate is marked dynamic so Try it out never sends a stale date', bookingSchema.bookingDate);
    ok(!!spec.paths['/availability'], 'The specification documents the availability endpoint');
    ok(!!spec.paths['/auth/apikey'] && !!spec.paths['/auth/basic'], 'The specification documents the API key and Basic endpoints');
    const validationExample = spec.components.responses.BookingValidation.content['application/json'].example;
    ok(validationExample.error.details.fieldErrors.bookingDate === 'Choose a valid Booking Date.', 'The specification shows the exact validation envelope', validationExample);

    const docs = fs.readFileSync(path.join(ROOT, 'public', 'docs.html'), 'utf8');
    ok(docs.includes('<span>Open the App</span>'), 'API Docs label reads "Open the App"');
    ok(/href="\/"\s+target="_blank"[^>]*data-testid="open-app-link"/.test(docs), 'The Open the App link targets a new tab');
    ok(docs.includes('value="admin"') && docs.includes('value="admin123"'), 'The Authorize modal is prefilled with the admin credentials');
    ok(docs.includes("dynamicValue('tomorrow')"), 'The docs generate a live date for date fields');

    const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    ok(index.indexOf('data-testid="logout"') < index.indexOf('data-testid="settings-open"'), 'The Settings gear sits after Sign Out in the header');
    ok(index.includes('data-testid="login-api-docs"'), 'The login screen exposes the API Docs');
    ok(index.includes('data-testid="settings-open-app"') && index.includes('Open the API Docs'), 'The UI drawer links to the API Docs');
    ok((index.match(/class="nav-link[^"]*"[^>]*href="/g) || []).length >= 6, 'Every header link is a real anchor with an href');

  } catch (e) {
    failed++;
    failures.push('Suite crashed: ' + e.message);
    console.log('\nSuite crashed: ' + e.stack);
  } finally {
    stop();
    try { fs.existsSync(TMP_DATA) && fs.unlinkSync(TMP_DATA); } catch { /* ignore */ }
  }

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`API regression: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(failed ? 1 : 0);
})();
