/* MeetSpaceSync v1.0.0 - Meeting Room Booking demo for UI and API automation practice.
   Plain Node.js, no dependencies. Start with: npm start   */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'meetspacesync-demo-secret';
const APP_VERSION = '1.0.0';

/* Practice credentials advertised in the Settings drawer and the API Docs. */
const API_KEY = 'meetspacesync-key-2026';
const BASIC_USER = 'meetspace';
const BASIC_PASS = 'basic123';

const techNames = ['Nova', 'Orbit', 'Quantum', 'Vector', 'Pixel', 'Cosmos', 'Astro', 'Nebula', 'Photon', 'Comet', 'Lunar', 'Solaris', 'Galaxy', 'Meteor', 'Zenith', 'Eclipse', 'Stellar', 'Pulsar', 'Voyager', 'Helix', 'Aurora', 'Kepler', 'Apollo', 'Vega', 'Sirius', 'Matrix', 'Grid', 'Circuit', 'Network', 'Link', 'Bridge', 'Hub', 'Node', 'Cloud', 'Cipher', 'Binary', 'Kernel', 'Protocol', 'Beacon', 'Signal', 'Router', 'Switch', 'Portal', 'Gateway', 'Stream', 'Sync', 'Pulse', 'Core', 'Logic', 'Data', 'Code', 'Stack', 'Fiber', 'Mesh', 'Connect', 'Titan', 'Falcon', 'Phoenix', 'Alpha', 'Prime', 'Velocity', 'Turbo', 'Rocket', 'Blaze', 'Summit', 'Crown', 'Peak', 'Striker', 'Valor', 'Victory', 'Nexus', 'Vertex', 'Apex', 'Catalyst', 'Fusion', 'Prism', 'Quasar', 'Ion', 'Atom', 'Drone', 'Radar', 'Laser', 'Cyber', 'Neon', 'Byte', 'Cache', 'Proxy', 'Server', 'Script', 'Module', 'Schema', 'Lambda', 'Delta', 'Omega', 'Sigma', 'Nimbus', 'Atlas', 'Orion', 'Artemis', 'Gemini', 'Saturn', 'Jupiter', 'Mercury', 'Mars', 'Venus', 'Pluto', 'Horizon', 'Infinity', 'Pioneer', 'Spark', 'Momentum', 'Impact', 'Elevate', 'Thrive', 'Vision', 'Insight', 'Focus', 'Agile', 'Sprint', 'Rapid', 'Smart', 'Digital', 'Dynamic', 'Future', 'Innovation', 'Synergy'];

function makeSeed() {
  const blocks = [
    { id: 'VERTEX', name: 'Vertex', floors: 10 },
    { id: 'APEX', name: 'Apex', floors: 5 },
    { id: 'NEXUS', name: 'Nexus', floors: 10 }
  ];
  const rooms = [];
  let ni = 0;
  for (const b of blocks) {
    for (let floor = 1; floor <= b.floors; floor++) {
      for (let r = 1; r <= 5; r++) {
        const pad = n => String(n).padStart(2, '0');
        rooms.push({
          id: `${b.id}-F${pad(floor)}-R${pad(r)}`,
          code: `${b.name[0]}-${pad(floor)}-${pad(r)}`,
          name: techNames[ni++],
          blockId: b.id,
          blockName: b.name,
          floor,
          capacity: [4, 6, 8, 10, 12][(floor + r) % 5],
          amenities: ['Display', 'Whiteboard', 'Video Call', 'Wi-Fi'].slice(0, 2 + ((floor + r) % 3)),
          status: 'ACTIVE'
        });
      }
    }
  }
  return {
    users: [
      { id: 'USR-ADMIN', username: 'admin', password: 'admin123', name: 'Administrator', role: 'ADMIN' },
      { id: 'USR-USER', username: 'user', password: 'user123', name: 'Standard User', role: 'USER' }
    ],
    blocks,
    rooms,
    bookings: []
  };
}

function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
function loadData() { if (!fs.existsSync(DATA_FILE)) saveData(makeSeed()); return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function resetData() { const d = makeSeed(); saveData(d); return d; }

/* ---------------- token helpers ---------------- */
const b64 = v => Buffer.from(v).toString('base64url');

function signToken(payload) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 28800 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [h, b, s] = String(token).split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if (!s || s !== expected) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url'));
    return payload.exp >= Date.now() / 1000 ? payload : null;
  } catch { return null; }
}

/* ---------------- http helpers ---------------- */
function json(res, status, body, extraHeaders) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(status === 204 ? '' : JSON.stringify(body, null, 2));
}
function fail(res, status, code, message, details, extraHeaders) {
  json(res, status, { error: { code, message, ...(details ? { details } : {}) } }, extraHeaders);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => {
      let parsed;
      try { parsed = s ? JSON.parse(s) : {}; } catch { return reject(new Error('Invalid JSON')); }
      /* "null", "42" and a bare string are all valid JSON but cannot be read
         with property access, so they are normalised to an empty object. */
      resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
    });
  });
}
function auth(req, res, role) {
  const header = req.headers.authorization || '';
  const user = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!user) { fail(res, 401, 'UNAUTHORIZED', 'Sign in or provide a valid Bearer token.'); return null; }
  if (role && user.role !== role) { fail(res, 403, 'FORBIDDEN', 'Admin access is required for this action.'); return null; }
  return user;
}

/* ---------------- audit and comments ---------------- */

/* Every change that alters a Booking or a Meeting Room has to say why, in
   words a person can read later. A single keystroke is not an explanation, so
   the comment is checked after trimming. */
const MIN_COMMENT = 5;
const MAX_COMMENT = 300;

function commentError(value, label) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return `${label} is required.`;
  if (v.length < MIN_COMMENT) return `${label} must contain at least ${MIN_COMMENT} characters.`;
  if (v.length > MAX_COMMENT) return `${label} cannot exceed ${MAX_COMMENT} characters.`;
  return '';
}

/* The trail is append only: an edit never overwrites the reason given for the
   edit before it. */
function appendAudit(record, action, comment, actor) {
  if (!Array.isArray(record.auditTrail)) record.auditTrail = [];
  record.auditTrail.push({
    action,
    comment: String(comment || '').trim(),
    by: actor.sub,
    byName: actor.name,
    at: new Date().toISOString()
  });
  return record.auditTrail;
}

/* ---------------- booking rules ---------------- */
function findConflicts(data, roomId, start, end, ignoreId) {
  return data.bookings.filter(b =>
    b.id !== ignoreId &&
    b.roomId === roomId &&
    b.status === 'BOOKED' &&
    new Date(b.startTime) < end &&
    new Date(b.endTime) > start
  );
}

/* A regex alone lets "99:99" and "2026-13-45" through, which then produced an
   Invalid Date and an error reported against the wrong field. These check the
   real ranges and that the parts survive a round trip. */
function isValidClock(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
function isValidDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function validateBooking(body, data, id) {
  const f = {};
  const title = String(body.meetingTitle || '').trim();
  const room = data.rooms.find(r => r.id === body.roomId);
  const att = Number(body.attendees);
  const date = String(body.bookingDate || '');
  const st = String(body.startClock || '');
  const et = String(body.endClock || '');
  const notes = String(body.notes || '').trim();

  if (!title) f.meetingTitle = 'Enter a Meeting Title.';
  else if (title.length < 3) f.meetingTitle = 'Meeting Title must contain at least 3 characters.';
  else if (title.length > 80) f.meetingTitle = 'Meeting Title cannot exceed 80 characters.';

  if (notes.length > 300) f.notes = 'Notes cannot exceed 300 characters.';

  if (!body.blockId) f.blockId = 'Select a Building.';
  if (!body.floor) f.floor = 'Select a Floor.';

  if (!room) f.roomId = 'Select an Available Room.';
  else if (room.blockId !== body.blockId || room.floor !== Number(body.floor)) f.roomId = 'Selected Room does not belong to the chosen Building and Floor.';
  else if (room.status !== 'ACTIVE') f.roomId = 'This Meeting Room is inactive.';

  if (!Number.isInteger(att) || att < 1) f.attendees = 'Enter at least 1 Attendee.';
  else if (room && att > room.capacity) f.attendees = `This Meeting Room supports up to ${room.capacity} Attendees.`;

  if (!isValidDate(date)) f.bookingDate = 'Choose a valid Booking Date.';
  if (!isValidClock(st)) f.startClock = 'Choose a valid Start Time.';
  if (!isValidClock(et)) f.endClock = 'Choose a valid End Time.';

  /* Only build the timestamps once the parts are known good, so a bad date
     never produces a second, misleading error against the times. */
  let start, end;
  if (!f.bookingDate && !f.startClock) start = new Date(`${date}T${st}:00`);
  if (!f.bookingDate && !f.endClock) end = new Date(`${date}T${et}:00`);

  if (start && start < Date.now() - 60000) f.startClock = 'Past Date or Time cannot be booked.';
  if (start && end && end <= start) f.endClock = 'End Time must be later than Start Time.';
  if (start && end && end - start > 4 * 3600000) f.endClock = 'Booking Duration cannot exceed 4 hours.';

  if (start && end && room && !f.roomId) {
    const clash = findConflicts(data, room.id, start, end, id)[0];
    if (clash) f.roomId = `${room.name} is already booked during this time.`;
  }
  return { f, title, room, att, start, end, notes };
}

/* ---------------- static files ---------------- */
function staticFile(res, p) {
  let file = p === '/' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, p.replace(/^\//, ''));
  if (p === '/docs' || p === '/docs.html') file = path.join(PUBLIC, 'docs.html');
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
  return true;
}

/* ---------------- api ---------------- */
async function api(req, res, u) {
  const p = u.pathname;
  const m = req.method;
  let d = loadData();

  if (m === 'GET' && p === '/api/ping') {
    return json(res, 200, { status: 'UP', app: 'MeetSpaceSync', version: APP_VERSION, time: new Date().toISOString(), rooms: d.rooms.length, bookings: d.bookings.length });
  }

  if (m === 'POST' && p === '/api/auth/login') {
    let b;
    try { b = await parseBody(req); } catch { return fail(res, 400, 'INVALID_JSON', 'Request body contains invalid JSON.'); }
    const found = d.users.find(v => v.username === String(b.username || '').trim() && v.password === String(b.password || ''));
    if (!found) return fail(res, 401, 'INVALID_CREDENTIALS', 'The Username or Password is incorrect.');
    const user = { id: found.id, username: found.username, name: found.name, role: found.role };
    return json(res, 200, { token: signToken({ sub: found.id, ...user }), user });
  }

  if (m === 'GET' && p === '/api/auth/me') {
    const x = auth(req, res);
    if (x) return json(res, 200, x);
    return;
  }

  /* Practice endpoints for header based authentication. */
  if (p === '/api/auth/apikey') {
    if (m !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    const key = req.headers['x-api-key'];
    if (!key) return fail(res, 401, 'MISSING_API_KEY', 'Send the header X-API-Key.');
    if (key !== API_KEY) return fail(res, 401, 'INVALID_API_KEY', 'That API key is not valid.');
    return json(res, 200, { authenticated: true, method: 'api-key' });
  }

  if (p === '/api/auth/basic') {
    if (m !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    const header = req.headers.authorization || '';
    const challenge = { 'WWW-Authenticate': 'Basic realm="MeetSpaceSync"' };
    if (!header.startsWith('Basic ')) return fail(res, 401, 'MISSING_BASIC_AUTH', 'Send HTTP Basic credentials.', undefined, challenge);
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { decoded = ''; }
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (user !== BASIC_USER || pass !== BASIC_PASS) return fail(res, 401, 'INVALID_BASIC_AUTH', 'Invalid Basic credentials.', undefined, challenge);
    return json(res, 200, { authenticated: true, method: 'basic', user });
  }

  if (m === 'GET' && p === '/api/overview') {
    return json(res, 200, {
      buildings: d.blocks.length,
      floors: d.blocks.reduce((n, b) => n + b.floors, 0),
      rooms: d.rooms.length,
      activeRooms: d.rooms.filter(r => r.status === 'ACTIVE').length,
      bookings: d.bookings.length
    });
  }

  if (m === 'GET' && p === '/api/blocks') {
    if (!auth(req, res)) return;
    return json(res, 200, d.blocks);
  }

  if (m === 'GET' && p === '/api/rooms') {
    if (!auth(req, res)) return;
    let rows = d.rooms;
    const blockId = u.searchParams.get('blockId');
    const status = u.searchParams.get('status');
    if (blockId) rows = rows.filter(r => r.blockId === blockId);
    if (status) rows = rows.filter(r => r.status === status);
    const fl = u.searchParams.get('floor');
    if (fl) rows = rows.filter(r => r.floor === Number(fl));
    return json(res, 200, rows);
  }

  /* Availability check used by the Book a Room form before the Booking is submitted. */
  if (m === 'GET' && p === '/api/availability') {
    if (!auth(req, res)) return;
    const roomId = u.searchParams.get('roomId') || '';
    const date = u.searchParams.get('bookingDate') || '';
    const st = u.searchParams.get('startClock') || '';
    const et = u.searchParams.get('endClock') || '';
    const ignoreId = u.searchParams.get('ignoreBookingId') || '';
    const room = d.rooms.find(r => r.id === roomId);
    const fieldErrors = {};
    if (!room) fieldErrors.roomId = 'Select an Available Room.';
    if (!isValidDate(date)) fieldErrors.bookingDate = 'Choose a valid Booking Date.';
    if (!isValidClock(st)) fieldErrors.startClock = 'Choose a valid Start Time.';
    if (!isValidClock(et)) fieldErrors.endClock = 'Choose a valid End Time.';
    if (Object.keys(fieldErrors).length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fieldErrors });
    const start = new Date(`${date}T${st}:00`);
    const end = new Date(`${date}T${et}:00`);
    if (end <= start) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fieldErrors: { endClock: 'End Time must be later than Start Time.' } });
    const conflicts = findConflicts(d, room.id, start, end, ignoreId);
    /* An inactive Room can never be booked, so reporting it as available would
       contradict what POST /bookings does with the same values. */
    const inactive = room.status !== 'ACTIVE';
    const available = !inactive && conflicts.length === 0;
    let message;
    if (inactive) message = 'This Meeting Room is inactive.';
    else if (conflicts.length) message = `${room.name} is already booked during this time.`;
    else message = `${room.name} is available for this time slot.`;
    return json(res, 200, {
      roomId: room.id,
      roomName: room.name,
      roomCode: room.code,
      roomStatus: room.status,
      bookingDate: date,
      startClock: st,
      endClock: et,
      available,
      message,
      conflicts: conflicts.map(b => ({ id: b.id, meetingTitle: b.meetingTitle, startTime: b.startTime, endTime: b.endTime, createdByName: b.createdByName }))
    });
  }

  if (m === 'GET' && p === '/api/bookings') {
    if (!auth(req, res)) return;
    const roomId = u.searchParams.get('roomId');
    const status = u.searchParams.get('status');
    let rows = d.bookings;
    if (roomId) rows = rows.filter(b => b.roomId === roomId);
    if (status) rows = rows.filter(b => b.status === status);
    return json(res, 200, rows);
  }

  if (m === 'POST' && p === '/api/bookings') {
    const x = auth(req, res);
    if (!x) return;
    let b;
    try { b = await parseBody(req); } catch { return fail(res, 400, 'INVALID_JSON', 'Request body contains invalid JSON.'); }
    const v = validateBooking(b, d);
    if (Object.keys(v.f).length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fieldErrors: v.f });
    const booking = {
      id: `BKG-${Date.now()}`,
      meetingTitle: v.title,
      roomId: v.room.id,
      roomName: v.room.name,
      roomCode: v.room.code,
      blockId: v.room.blockId,
      blockName: v.room.blockName,
      floor: v.room.floor,
      attendees: v.att,
      startTime: v.start.toISOString(),
      endTime: v.end.toISOString(),
      notes: v.notes,
      status: 'BOOKED',
      createdBy: x.sub,
      createdByName: x.name,
      createdAt: new Date().toISOString()
    };
    appendAudit(booking, 'CREATED', `Booking created by ${x.name}.`, x);
    d.bookings.unshift(booking);
    saveData(d);
    return json(res, 201, booking);
  }

  const bm = p.match(/^\/api\/bookings\/([^/]+)$/);

  if (bm && m === 'GET') {
    if (!auth(req, res)) return;
    const one = d.bookings.find(b => b.id === bm[1]);
    if (!one) return fail(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    return json(res, 200, one);
  }

  if (bm && m === 'PUT') {
    const x = auth(req, res);
    if (!x) return;
    const old = d.bookings.find(b => b.id === bm[1]);
    if (!old) return fail(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    if (x.role !== 'ADMIN' && old.createdBy !== x.sub) return fail(res, 403, 'FORBIDDEN', 'You can update only your own Booking.');
    if (old.status === 'CANCELLED') return fail(res, 409, 'BOOKING_CANCELLED', 'A cancelled Booking cannot be updated. Create a new Booking instead.');
    let b;
    try { b = await parseBody(req); } catch { return fail(res, 400, 'INVALID_JSON', 'Request body contains invalid JSON.'); }
    const v = validateBooking(b, d, old.id);
    const updateCommentError = commentError(b.updateComment, 'Reason for Update');
    if (updateCommentError) v.f.updateComment = updateCommentError;
    if (Object.keys(v.f).length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fieldErrors: v.f });
    Object.assign(old, {
      meetingTitle: v.title,
      roomId: v.room.id,
      roomName: v.room.name,
      roomCode: v.room.code,
      blockId: v.room.blockId,
      blockName: v.room.blockName,
      floor: v.room.floor,
      attendees: v.att,
      startTime: v.start.toISOString(),
      endTime: v.end.toISOString(),
      notes: v.notes,
      updatedAt: new Date().toISOString(),
      updatedBy: x.sub,
      updatedByName: x.name,
      updateComment: String(b.updateComment).trim()
    });
    appendAudit(old, 'UPDATED', b.updateComment, x);
    saveData(d);
    return json(res, 200, old);
  }

  if (bm && m === 'DELETE') {
    const x = auth(req, res);
    if (!x) return;
    const old = d.bookings.find(b => b.id === bm[1]);
    if (!old) return fail(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    if (x.role !== 'ADMIN' && old.createdBy !== x.sub) return fail(res, 403, 'FORBIDDEN', 'You can cancel only your own Booking.');
    if (old.status === 'CANCELLED') return fail(res, 409, 'ALREADY_CANCELLED', 'Booking is already cancelled.');
    let b = {};
    try { b = await parseBody(req); } catch { return fail(res, 400, 'INVALID_JSON', 'Request body contains invalid JSON.'); }
    const reason = String(b.reason || '').trim();
    const reasonError = commentError(reason, 'Cancellation Comment');
    if (reasonError) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a Cancellation Comment.', { fieldErrors: { reason: reasonError } });
    old.status = 'CANCELLED';
    old.cancellationComment = reason;
    old.cancelledAt = new Date().toISOString();
    old.cancelledBy = x.sub;
    old.cancelledByName = x.name;
    appendAudit(old, 'CANCELLED', reason, x);
    saveData(d);
    return json(res, 200, old);
  }

  const rm = p.match(/^\/api\/rooms\/([^/]+)$/);

  if (rm && m === 'GET') {
    if (!auth(req, res)) return;
    const room = d.rooms.find(r => r.id === rm[1]);
    if (!room) return fail(res, 404, 'ROOM_NOT_FOUND', 'Meeting Room not found.');
    return json(res, 200, room);
  }

  if (rm && m === 'PATCH') {
    const admin = auth(req, res, 'ADMIN');
    if (!admin) return;
    const room = d.rooms.find(r => r.id === rm[1]);
    if (!room) return fail(res, 404, 'ROOM_NOT_FOUND', 'Meeting Room not found.');
    let b;
    try { b = await parseBody(req); } catch { return fail(res, 400, 'INVALID_JSON', 'Request body contains invalid JSON.'); }
    if (!['ACTIVE', 'INACTIVE'].includes(b.status)) return fail(res, 400, 'VALIDATION_ERROR', 'Status must be ACTIVE or INACTIVE.');
    if (b.status === 'INACTIVE') {
      const future = d.bookings.filter(v => v.roomId === room.id && v.status === 'BOOKED' && new Date(v.endTime) > new Date());
      if (future.length) {
        return fail(res, 409, 'ROOM_HAS_FUTURE_BOOKINGS', 'This Meeting Room has future Bookings. Cancel them with a Cancellation Comment before deactivating the Room.', {
          bookingIds: future.map(v => v.id),
          bookings: future.map(v => ({ id: v.id, meetingTitle: v.meetingTitle, startTime: v.startTime, endTime: v.endTime }))
        });
      }
      const reason = String(b.reason || '').trim();
      const reasonError = commentError(reason, 'Deactivation Comment');
      if (reasonError) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a Deactivation Comment.', { fieldErrors: { reason: reasonError } });
      room.deactivationComment = reason;
      room.deactivatedAt = new Date().toISOString();
      room.deactivatedBy = admin.sub;
      room.deactivatedByName = admin.name;
      appendAudit(room, 'DEACTIVATED', reason, admin);
    } else {
      /* Activation needs no reason, but the trail keeps the history of why the
         Room was taken out of service in the first place. */
      room.deactivationComment = '';
      room.activatedAt = new Date().toISOString();
      room.activatedByName = admin.name;
      appendAudit(room, 'ACTIVATED', `Returned to service by ${admin.name}.`, admin);
    }
    room.status = b.status;
    saveData(d);
    return json(res, 200, room);
  }

  if (m === 'POST' && p === '/api/reset') {
    if (!auth(req, res, 'ADMIN')) return;
    d = resetData();
    return json(res, 200, { message: 'Demo data restored.', rooms: d.rooms.length, bookings: d.bookings.length });
  }

  return fail(res, 404, 'ROUTE_NOT_FOUND', `${m} ${p} was not found.`);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || HOST}`);
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (staticFile(res, u.pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    /* An unexpected fault answers with 500 rather than ending the process. */
    console.error('Unhandled request error:', e && e.stack ? e.stack : e);
    if (!res.headersSent) fail(res, 500, 'INTERNAL_ERROR', 'The server could not complete this request.');
    else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`
MeetSpaceSync ${APP_VERSION} is running
UI        : http://${HOST}:${PORT}/
API docs  : http://${HOST}:${PORT}/docs   (also /docs.html)
API base  : http://${HOST}:${PORT}/api

Accounts  : admin/admin123 (full access) | user/user123 (standard access)
`));

module.exports = server;
