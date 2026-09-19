/* MeetSpaceSync v1.0.0 - single page UI.
   Rewritten as one clean layer: no stacked overrides, one definition per function. */

/* ------------------------------------------------------------------ *
 * 1. Small helpers
 * ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[c]));

/* Search text is normalised on both sides so that a value copied straight out
   of a table cell, for example "Nova - V-01-01" with a middle dot separator,
   still matches. Every token has to be found, in any order. */
function normalizeSearch(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[\u00b7\u2022\u2013\u2014|,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function matchesQuery(haystack, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  const hay = normalizeSearch(haystack);
  return q.split(' ').every(token => hay.includes(token));
}

const pad2 = n => String(n).padStart(2, '0');

/* One display standard across the whole UI: dates as DD-MM-YYYY and times as
   hh:mm AM/PM, matching how the Start Time and End Time controls read.
   Locale formatting is deliberately not used, so the app looks identical on
   every machine. The API contract is untouched: requests still carry
   YYYY-MM-DD and HH:MM, and responses still carry ISO 8601 timestamps. */

/* From a Date or an ISO timestamp. */
function fmtDate(value) {
  const d = new Date(value);
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}
function fmtTime(value) {
  const d = new Date(value);
  const suffix = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${pad2(d.getHours() % 12 || 12)}:${pad2(d.getMinutes())} ${suffix}`;
}
function fmt(value) {
  return `${fmtDate(value)}, ${fmtTime(value)}`;
}

/* From the raw control values, so the Booking form reads the same way. */
function fmtDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '';
  const [y, m, d] = value.split('-');
  return `${d}-${m}-${y}`;
}
function fmtClockValue(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return value || '';
  const [h, min] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${pad2(h % 12 || 12)}:${pad2(min)} ${suffix}`;
}

function localParts(value) {
  const d = new Date(value);
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/* ------------------------------------------------------------------ *
 * 2. Application state
 * ------------------------------------------------------------------ */
const state = {
  token: localStorage.getItem('mss-token') || '',
  user: null,
  base: localStorage.getItem('mss-base') || '/api',
  blocks: [],
  rooms: [],
  bookings: [],
  route: 'dashboard',
  editing: null,
  prefill: null,
  roomPage: 1,
  bookingPage: 1,
  pageSize: 10,
  bookingSort: 'startTime',
  bookingDir: 'asc',
  roomSort: 'name',
  roomDir: 'asc'
};

const currentUserId = () => (state.user ? state.user.sub || state.user.id : '');
const isAdmin = () => !!state.user && state.user.role === 'ADMIN';

/* The Book a Room preselection survives a full page load, so a Meeting Room
   link opened with Ctrl+Click in a new tab still arrives prefilled. */
function setPrefill(value) {
  state.prefill = value;
  try {
    if (value) sessionStorage.setItem('mss-prefill', JSON.stringify(value));
    else sessionStorage.removeItem('mss-prefill');
  } catch { /* storage disabled, in memory prefill still works */ }
}
function takePrefill() {
  let value = state.prefill;
  if (!value) {
    try { value = JSON.parse(sessionStorage.getItem('mss-prefill') || 'null'); } catch { value = null; }
  }
  setPrefill(null);
  return value;
}

/* ------------------------------------------------------------------ *
 * 3. API client
 * ------------------------------------------------------------------ */
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(state.base + path, { ...options, headers });
  } catch {
    throw { message: `Cannot reach ${state.base}. Check the Server and Settings.`, details: {} };
  }
  let body = {};
  if (response.status !== 204) { try { body = await response.json(); } catch { body = {}; } }
  if (!response.ok) {
    const err = body.error || {};
    throw { status: response.status, code: err.code, message: err.message || 'Request failed.', details: err.details || {} };
  }
  return body;
}

/* ------------------------------------------------------------------ *
 * 4. Toasts, dialogs and field errors
 * ------------------------------------------------------------------ */
function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.setAttribute('data-testid', 'toast');
  node.textContent = message;
  $('toastStack').append(node);
  setTimeout(() => node.remove(), 3600);
}

function clearErrors() {
  $$('.field').forEach(x => x.classList.remove('invalid'));
  $$('.field-error').forEach(x => { x.textContent = ''; });
}
function fieldError(id, message) {
  const input = $(id);
  const slot = $(id + 'Error');
  if (input && input.closest('.field')) input.closest('.field').classList.add('invalid');
  if (slot) slot.textContent = message;
}

/* Dialog focus handling. Opening a dialog moves the keyboard into it, Tab is
   kept inside while it is open, and closing returns focus to whatever opened
   it. Without this a keyboard or screen reader user is left behind the dialog. */
let dialogReturnFocus = null;
let dialogTrap = null;

function dialogFocusables(dialog) {
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(dialog.querySelectorAll(selector))
    .filter(el => !el.disabled && el.getClientRects().length > 0);
}

function openDialog(html) {
  dialogReturnFocus = document.activeElement;
  $('modalRoot').innerHTML = html;
  const dialog = $('modalRoot').querySelector('.modal');
  if (!dialog) return;
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  const focusables = dialogFocusables(dialog);
  (focusables[0] || dialog).focus();
  dialogTrap = e => {
    if (e.key !== 'Tab') return;
    const list = dialogFocusables(dialog);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', dialogTrap, true);
}

function closeModal() {
  if (dialogTrap) {
    document.removeEventListener('keydown', dialogTrap, true);
    dialogTrap = null;
  }
  $('modalRoot').innerHTML = '';
  if (dialogReturnFocus && document.body.contains(dialogReturnFocus) && typeof dialogReturnFocus.focus === 'function') {
    dialogReturnFocus.focus({ preventScroll: true });
  }
  dialogReturnFocus = null;
}

/* Confirmation dialog: Cancel plus a confirm action. */
function modal(title, text, confirmLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    openDialog(`
      <div class="modal-backdrop" data-testid="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" data-testid="confirm-dialog">
          <h3 data-testid="dialog-title">${esc(title)}</h3>
          <p data-testid="dialog-text">${esc(text)}</p>
          <div class="modal-actions">
            <button class="btn secondary" id="modalCancel" data-testid="dialog-cancel">Cancel</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" id="modalConfirm" data-testid="dialog-confirm">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    $('modalCancel').onclick = () => { closeModal(); resolve(false); };
    $('modalConfirm').onclick = () => { closeModal(); resolve(true); };
  });
}

/* Blocking message dialog. Uses the same frame as the confirmation dialog so
   that important errors are shown in the centre of the screen, not as a toast. */
function alertDialog(title, text, options = {}) {
  const { tone = 'warn', listHtml = '', closeLabel = 'Close', actionLabel = '', testid = 'alert-dialog' } = options;
  return new Promise(resolve => {
    openDialog(`
      <div class="modal-backdrop" data-testid="modal-backdrop">
        <div class="modal alert-modal tone-${esc(tone)}" role="alertdialog" aria-modal="true" data-testid="${esc(testid)}">
          <div class="alert-modal-head">
            <span class="alert-modal-icon" aria-hidden="true">${tone === 'warn' ? '!' : 'i'}</span>
            <h3 data-testid="dialog-title">${esc(title)}</h3>
          </div>
          <p data-testid="dialog-text">${esc(text)}</p>
          ${listHtml}
          <div class="modal-actions">
            ${actionLabel ? `<button class="btn primary" id="alertAction" data-testid="dialog-action">${esc(actionLabel)}</button>` : ''}
            <button class="btn secondary" id="alertClose" data-testid="dialog-close">${esc(closeLabel)}</button>
          </div>
        </div>
      </div>`);
    $('alertClose').onclick = () => { closeModal(); resolve(false); };
    if (actionLabel) $('alertAction').onclick = () => { closeModal(); resolve(true); };
  });
}

/* The same comment rule the server applies, so the dialog and the API never
   disagree. A single keystroke is not an explanation, and the trim stops five
   spaces passing for one. */
const MIN_COMMENT = 5;
function commentProblem(value, label) {
  const v = String(value || '').trim();
  if (!v) return `${label} is required.`;
  if (v.length < MIN_COMMENT) return `${label} must contain at least ${MIN_COMMENT} characters.`;
  if (v.length > 300) return `${label} cannot exceed 300 characters.`;
  return '';
}

/* Dialog that collects a mandatory comment. */
function reasonDialog(title, description, label) {
  return new Promise(resolve => {
    openDialog(`
      <div class="modal-backdrop" data-testid="modal-backdrop">
        <div class="modal detail-modal" role="dialog" aria-modal="true" data-testid="reason-dialog">
          <span class="eyebrow">Administrator Action</span>
          <h3 data-testid="dialog-title">${esc(title)}</h3>
          <p data-testid="dialog-text">${esc(description)}</p>
          <div class="field">
            <label for="reasonInput">${esc(label)}</label>
            <textarea id="reasonInput" data-testid="reason-input" rows="4" maxlength="300" placeholder="Enter a clear reason for the audit history"></textarea>
            <small id="reasonInputError" class="field-error" data-testid="reason-error"></small>
          </div>
          <div class="modal-actions">
            <button class="btn secondary" id="reasonCancel" data-testid="reason-cancel">Cancel</button>
            <button class="btn danger" id="reasonConfirm" data-testid="reason-confirm">Continue</button>
          </div>
        </div>
      </div>`);
    $('reasonCancel').onclick = () => { closeModal(); resolve(null); };
    $('reasonConfirm').onclick = () => {
      const value = $('reasonInput').value.trim();
      const problem = commentProblem(value, label);
      if (problem) { fieldError('reasonInput', problem); $('reasonInput').focus(); return; }
      closeModal();
      resolve(value);
    };
    $('reasonInput').addEventListener('input', () => {
      if (!$('reasonInputError').textContent) return;
      const problem = commentProblem($('reasonInput').value.trim(), label);
      $('reasonInputError').textContent = problem;
      const field = $('reasonInput').closest('.field');
      if (field) field.classList.toggle('invalid', !!problem);
    });
  });
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('modalRoot').innerHTML) closeModal();
  else closeDrawer();
});

/* ------------------------------------------------------------------ *
 * 5. Session
 * ------------------------------------------------------------------ */
async function preload() {
  const [blocks, rooms, bookings] = await Promise.all([api('/blocks'), api('/rooms'), api('/bookings')]);
  state.blocks = blocks;
  state.rooms = rooms;
  state.bookings = bookings;
}

function showLogin() {
  $('username').value = '';
  $('password').value = '';
  $('loginBanner').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  $('logout').classList.add('hidden');
  $('userChip').classList.add('hidden');
  $$('.auth-only').forEach(x => x.classList.add('hidden'));
  $$('.guest-only').forEach(x => x.classList.remove('hidden'));
}

function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('logout').classList.remove('hidden');
  $('userChip').classList.remove('hidden');
  $('userChip').textContent = `${state.user.name} - ${isAdmin() ? 'Admin' : 'User'}`;
  $$('.auth-only').forEach(x => x.classList.remove('hidden'));
  $$('.guest-only').forEach(x => x.classList.add('hidden'));
}

async function restore() {
  if (!state.token) return applyRoute();
  try {
    const me = await api('/auth/me');
    state.user = { ...me, sub: me.sub || me.id, id: me.id || me.sub };
    showApp();
    await preload();
    applyRoute();
  } catch {
    state.token = '';
    state.user = null;
    localStorage.removeItem('mss-token');
    applyRoute();
  }
}

async function signIn() {
  clearErrors();
  $('loginBanner').classList.add('hidden');
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username) fieldError('username', 'Enter a Username.');
  if (!password) fieldError('password', 'Enter a Password.');
  if (!username || !password) {
    $(!username ? 'username' : 'password').focus();
    return;
  }
  $('loginButton').disabled = true;
  try {
    const out = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    state.token = out.token;
    /* The login response carries "id"; the token payload carries "sub".
       Both are kept so that ownership checks work straight after sign in. */
    state.user = { ...out.user, sub: out.user.id, id: out.user.id };
    localStorage.setItem('mss-token', out.token);
    $('password').value = '';
    showApp();
    const hashAtSignIn = location.hash;
    await preload();
    /* Loading the Buildings, Rooms and Bookings takes a moment. If the person
       clicked a header link while that was in flight, honour their choice
       rather than dragging them back to the Overview. */
    if (location.hash === hashAtSignIn) nav('dashboard');
    else applyRoute();
    toast('Signed In successfully.');
  } catch (e) {
    $('loginBanner').textContent = e.message;
    $('loginBanner').classList.remove('hidden');
    $('username').focus();
  } finally {
    $('loginButton').disabled = false;
  }
}

function signOut() {
  state.token = '';
  state.user = null;
  state.editing = null;
  setPrefill(null);
  localStorage.removeItem('mss-token');
  showLogin();
  toast('Signed Out.');
}

/* ------------------------------------------------------------------ *
 * 6. Routing. Every header link is a real anchor with an href, so the
 *    browser can open it in a new tab. The hash is the single source
 *    of truth and hashchange drives the render.
 * ------------------------------------------------------------------ */
const ROUTES = ['dashboard', 'book', 'bookings', 'rooms', 'playground'];
const ROUTE_ALIASES = { admin: 'rooms', '': 'dashboard' };

function normalizeRoute(raw) {
  const value = String(raw || '').replace(/^#\/?/, '').split('?')[0];
  const mapped = ROUTE_ALIASES[value] || value;
  return ROUTES.includes(mapped) ? mapped : 'dashboard';
}

function applyRoute() {
  const route = normalizeRoute(location.hash);
  state.route = route;
  $$('a[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route));

  /* The Playground is pure UI practice with no protected data, so it is
     reachable without a session. Every other route needs sign in. */
  if (!state.user) {
    if (route === 'playground') return renderGuestPlayground();
    showLogin();
    return;
  }
  render();
}

function renderGuestPlayground() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('page').innerHTML = playgroundPage(true);
  wirePlayground();
  window.scrollTo({ top: 0 });
}

function nav(route) {
  const target = '#/' + route;
  if (location.hash === target) applyRoute();
  else location.hash = target;
}

window.addEventListener('hashchange', applyRoute);

function render() {
  if (!state.user) return;
  const pages = { dashboard: dashboardPage, book: bookPage, bookings: bookingsPage, rooms: roomsPage, playground: playgroundPage };
  const page = pages[state.route] || dashboardPage;
  if (state.route !== 'book') state.editing = null;
  $('page').innerHTML = page();
  if (state.route === 'book') wireBook();
  if (state.route === 'bookings') wireBookings();
  if (state.route === 'rooms') wireRooms();
  if (state.route === 'playground') wirePlayground();
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------------ *
 * 7. Overview page
 * ------------------------------------------------------------------ */
function myActiveBookings() {
  const me = currentUserId();
  return state.bookings.filter(b => b.createdBy === me && b.status === 'BOOKED');
}

function dashboardPage() {
  const activeRooms = state.rooms.filter(r => r.status === 'ACTIVE').length;
  const mine = myActiveBookings();
  const upcoming = mine.filter(b => new Date(b.endTime) > new Date()).length;
  const floors = state.blocks.reduce((n, b) => n + b.floors, 0);
  return `
  <div class="page">
    <div class="page-head">
      <div>
        <span class="eyebrow">Workspace Overview</span>
        <h1 data-testid="page-title">Good to see you, ${esc(state.user.name)}</h1>
        <p>Reserve the right Meeting Room through a smooth, progressive booking experience.</p>
      </div>
      <a class="btn primary" href="#/book" data-testid="dashboard-book-cta">Book a Room</a>
    </div>
    <div class="summary-grid">
      <div class="card stat-card" data-testid="stat-buildings"><span class="label">Buildings</span><strong>${state.blocks.length}</strong><div class="trend">${state.blocks.map(b => esc(b.name)).join(' - ')}</div></div>
      <div class="card stat-card" data-testid="stat-floors"><span class="label">Floors</span><strong>${floors}</strong><div class="trend">Balanced across Campus</div></div>
      <div class="card stat-card" data-testid="stat-rooms"><span class="label">Meeting Rooms</span><strong>${state.rooms.length}</strong><div class="trend">${activeRooms} currently Active</div></div>
      <div class="card stat-card" data-testid="stat-my-bookings"><span class="label">Your Bookings</span><strong data-testid="my-bookings-count">${mine.length}</strong><div class="trend">${mine.length ? `${upcoming} upcoming, ${mine.length - upcoming} in progress or past` : 'No active Bookings yet'}</div></div>
    </div>
    <div class="building-grid">
      ${state.blocks.map(b => `
        <div class="card building-card" data-testid="building-card-${esc(b.id)}">
          <h3><span>${esc(b.name)}</span><span class="badge success">${b.floors} Floors</span></h3>
          <p>${b.floors * 5} uniquely named Meeting Rooms</p>
          <button class="btn secondary" data-explore="${esc(b.id)}" data-testid="explore-${esc(b.id)}">Explore ${esc(b.name)}</button>
        </div>`).join('')}
    </div>
    ${mine.length ? `
    <div class="card" style="margin-top:20px">
      <h3 style="margin-top:0">Your latest Bookings</h3>
      <div class="table-wrap">
        <table class="data-table" data-testid="my-bookings-table">
          <thead><tr><th>Meeting</th><th>Meeting Room</th><th>Date &amp; Time</th><th>Status</th></tr></thead>
          <tbody>${mine.slice(0, 5).map(b => `
            <tr>
              <td class="booking-name"><b>${esc(b.meetingTitle)}</b><span>${b.attendees} Attendees</span></td>
              <td class="room-name"><b>${esc(b.roomName)} &middot; ${esc(b.roomCode)}</b><span>${esc(b.blockName)}, Floor ${b.floor}</span></td>
              <td class="date-cell"><b>${fmt(b.startTime)}</b><small>to ${fmt(b.endTime)}</small></td>
              <td><span class="badge success">${esc(b.status)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 8. Book a Room page
 * ------------------------------------------------------------------ */
function bookPage() {
  const editing = state.editing;
  return `
  <div class="page">
    <div class="page-head">
      <div>
        <span class="eyebrow">Smart Reservation</span>
        <h1 data-testid="page-title">${editing ? 'Edit Booking' : 'Book a Room'}</h1>
        <p>Selections are progressive: Building, then Floor, then Available Room. Availability is checked while you type.</p>
      </div>
      <a class="btn secondary" href="#/rooms" data-testid="book-browse-rooms">Browse Meeting Rooms</a>
    </div>
    <div id="bookingAlert" class="alert error hidden" data-testid="booking-alert" role="alert"></div>
    <div class="booking-layout">
      <div class="card">
        <div class="form-grid">
          <div class="field full">
            <label for="meetingTitle">Meeting Title</label>
            <input id="meetingTitle" data-testid="meeting-title" maxlength="80" placeholder="Sprint Planning" />
            <small id="meetingTitleError" class="field-error" data-testid="meeting-title-error"></small>
          </div>
          <div class="field">
            <label for="blockId">Building</label>
            <select id="blockId" data-testid="building">
              <option value="">Select a Building</option>
              ${state.blocks.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
            </select>
            <small id="blockIdError" class="field-error" data-testid="building-error"></small>
          </div>
          <div class="field">
            <label for="floor">Floor</label>
            <select id="floor" data-testid="floor" disabled><option value="">Select a Floor</option></select>
            <small id="floorError" class="field-error" data-testid="floor-error"></small>
          </div>
          <div class="field full">
            <label for="roomId">Available Room</label>
            <select id="roomId" data-testid="room" disabled><option value="">Select an Available Room</option></select>
            <small id="roomIdError" class="field-error" data-testid="room-error"></small>
          </div>
          <div class="field">
            <label for="bookingDate">Booking Date</label>
            <input id="bookingDate" type="date" data-testid="booking-date" />
            <small id="bookingDateError" class="field-error" data-testid="booking-date-error"></small>
          </div>
          <div class="field">
            <label for="attendees">Attendees</label>
            <input id="attendees" type="number" min="1" value="1" data-testid="attendees" />
            <small id="attendeesError" class="field-error" data-testid="attendees-error"></small>
          </div>
          <div class="field">
            <label for="startClock">Start Time</label>
            <input id="startClock" type="time" step="60" data-testid="start-time" />
            <small id="startClockError" class="field-error" data-testid="start-time-error"></small>
          </div>
          <div class="field">
            <label for="endClock">End Time</label>
            <input id="endClock" type="time" step="60" data-testid="end-time" />
            <small id="endClockError" class="field-error" data-testid="end-time-error"></small>
          </div>
          <div class="field full">
            <label for="notes">Notes <span class="optional-label">(Optional)</span></label>
            <textarea id="notes" rows="3" maxlength="300" data-testid="notes" placeholder="Optional information for Attendees"></textarea>
            <small id="notesError" class="field-error"></small>
          </div>
        </div>

        <div id="availabilityPanel" class="availability idle" data-testid="availability-panel" aria-live="polite">
          <span class="availability-title">Live Availability</span>
          <p class="availability-text" data-testid="availability-message">Choose a Meeting Room, a Date and a time range to see live availability.</p>
        </div>

        <div class="play-row form-actions">
          <button id="saveBooking" class="btn primary" data-testid="confirm-booking">${state.editing ? 'Update Booking' : 'Confirm Booking'}</button>
          ${state.editing ? '<button id="cancelEdit" class="btn secondary" data-testid="cancel-edit">Cancel Edit</button>' : ''}
        </div>
      </div>

      <aside class="card summary-panel">
        <span class="eyebrow">Live Preview</span>
        <h3>Booking Summary</h3>
        <div id="bookingSummary" class="summary-list" data-testid="booking-summary"></div>
      </aside>
    </div>
  </div>`;
}

function fillFloors(blockId, keepFloor) {
  const block = state.blocks.find(b => b.id === blockId);
  const select = $('floor');
  select.disabled = !block;
  select.innerHTML = '<option value="">Select a Floor</option>' +
    (block ? Array.from({ length: block.floors }, (_, i) => `<option value="${i + 1}">Floor ${i + 1}</option>`).join('') : '');
  if (keepFloor) select.value = String(keepFloor);
}

function fillRooms(blockId, floor, keepRoom) {
  const rows = state.rooms.filter(r => r.blockId === blockId && r.floor === Number(floor) && r.status === 'ACTIVE');
  const select = $('roomId');
  select.disabled = !rows.length;
  select.innerHTML = '<option value="">Select an Available Room</option>' +
    rows.map(r => `<option value="${esc(r.id)}">${esc(r.name)} &middot; ${esc(r.code)} &middot; Capacity ${r.capacity}</option>`).join('');
  if (keepRoom && rows.some(r => r.id === keepRoom)) select.value = keepRoom;
}

function updateSummary() {
  const room = state.rooms.find(r => r.id === ($('roomId') ? $('roomId').value : ''));
  const block = state.blocks.find(b => b.id === ($('blockId') ? $('blockId').value : ''));
  const date = $('bookingDate').value;
  const start = $('startClock').value;
  const end = $('endClock').value;
  const parts = [
    ['Meeting', $('meetingTitle').value || 'Not entered'],
    ['Location', room ? `${room.name} - ${room.code}, ${block ? block.name : ''}, Floor ${room.floor}` : 'Select a Meeting Room'],
    ['Schedule', date && start && end ? `${fmtDateValue(date)}, ${fmtClockValue(start)} to ${fmtClockValue(end)}` : 'Select Date and Time'],
    ['Capacity', room ? `${$('attendees').value || 1} of ${room.capacity} Attendees` : 'Select a Meeting Room'],
    ['Amenities', room ? room.amenities.join(' - ') : 'Displayed after Room selection']
  ];
  $('bookingSummary').innerHTML = parts.map(([label, value]) =>
    `<div class="summary-item"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
}

/* Validation is split in two. fieldMessage is the pure rule check; validateField
   decides whether that message is allowed on screen yet. A field stays quiet
   until the person has left it or pressed Confirm Booking, so no error appears
   for something they are still filling in, or have not reached at all. */
const touchedFields = new Set();
const externalErrors = {};
let submitAttempted = false;

function resetFieldTracking() {
  touchedFields.clear();
  Object.keys(externalErrors).forEach(k => delete externalErrors[k]);
  submitAttempted = false;
}

/* A clash is decided by the server and cannot be recomputed from the form, so
   it is held separately. Re-validating a field must not silently erase it. */
function setExternalError(id, message) {
  externalErrors[id] = message;
  markTouched(id);
  validateField(id);
}
function clearExternalError(id) {
  delete externalErrors[id];
}
function clearExternalErrors() {
  Object.keys(externalErrors).forEach(k => delete externalErrors[k]);
}
function markTouched(id) {
  touchedFields.add(id);
}

function fieldMessage(id) {
  const el = $(id);
  if (!el) return '';
  const raw = el.value;
  const value = typeof raw === 'string' ? raw.trim() : raw;
  let msg = '';

  if (id === 'meetingTitle') {
    if (!value) msg = 'Enter a Meeting Title.';
    else if (value.length < 3) msg = 'Meeting Title must contain at least 3 characters.';
    else if (value.length > 80) msg = 'Meeting Title cannot exceed 80 characters.';
  }
  if (id === 'blockId' && !value) msg = 'Select a Building.';
  if (id === 'floor' && !value) msg = 'Select a Floor.';
  if (id === 'roomId' && !value) msg = 'Select an Available Room.';
  if (id === 'bookingDate') {
    if (!value) msg = 'Choose a valid Booking Date.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) msg = 'Choose a valid Booking Date.';
    else if (value < todayISO()) msg = 'Past Dates cannot be booked.';
  }
  if (id === 'attendees') {
    const room = state.rooms.find(r => r.id === $('roomId').value);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) msg = 'Enter at least 1 Attendee.';
    else if (room && n > room.capacity) msg = `This Meeting Room supports up to ${room.capacity} Attendees.`;
  }
  if (id === 'startClock') {
    if (!value) msg = 'Choose a valid Start Time.';
    else if ($('bookingDate').value === todayISO()) {
      /* Today's date with a time that has already gone by. The server rejects
         this, so the form says so immediately rather than waiting for Confirm
         and then leaving a stale message behind. */
      const [h, m] = value.split(':').map(Number);
      const chosen = new Date();
      chosen.setHours(h, m, 0, 0);
      if (chosen.getTime() < Date.now() - 60000) msg = 'Past Date or Time cannot be booked.';
    }
  }
  if (id === 'endClock') {
    const startValue = $('startClock').value;
    if (!value) msg = 'Choose a valid End Time.';
    else if (startValue && value <= startValue) msg = 'End Time must be later than Start Time.';
    else if (startValue) {
      const [sh, sm] = startValue.split(':').map(Number);
      const [eh, em] = value.split(':').map(Number);
      if ((eh * 60 + em) - (sh * 60 + sm) > 240) msg = 'Booking Duration cannot exceed 4 hours.';
    }
  }
  return msg;
}

function validateField(id) {
  const el = $(id);
  if (!el) return true;
  const msg = fieldMessage(id) || externalErrors[id] || '';
  const visible = submitAttempted || touchedFields.has(id);
  const shown = visible ? msg : '';
  if (el.closest('.field')) el.closest('.field').classList.toggle('invalid', !!shown);
  if ($(id + 'Error')) $(id + 'Error').textContent = shown;
  return !msg;
}

/* The first field that is actually wrong, in the order they appear on screen. */
function firstInvalidField() {
  return BOOKING_FIELDS.find(id => fieldMessage(id) || externalErrors[id]) || '';
}

/* On a failed Confirm the person may be scrolled well below the form, so bring
   the offending field to them and put the cursor in it. */
function revealFirstInvalid() {
  const id = firstInvalidField();
  const target = id ? $(id) : $('bookingAlert');
  if (!target) return;
  const anchor = target.closest('.field') || target;
  if (id && typeof target.focus === 'function') target.focus({ preventScroll: true });
  anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---- live availability ------------------------------------------- */
let availabilityTimer = null;
let availabilityToken = 0;
let lastAvailability = null;

function renderAvailability(kind, title, message, listHtml) {
  const panel = $('availabilityPanel');
  if (!panel) return;
  panel.className = `availability ${kind}`;
  panel.innerHTML = `
    <span class="availability-title">${esc(title)}</span>
    <p class="availability-text" data-testid="availability-message">${esc(message)}</p>
    ${listHtml || ''}`;
}

function scheduleAvailabilityCheck() {
  clearTimeout(availabilityTimer);
  availabilityTimer = setTimeout(checkAvailability, 220);
}

async function checkAvailability() {
  if (state.route !== 'book' || !$('availabilityPanel')) return;
  const roomId = $('roomId').value;
  const bookingDate = $('bookingDate').value;
  const startClock = $('startClock').value;
  const endClock = $('endClock').value;

  if (!roomId || !bookingDate || !startClock || !endClock) {
    lastAvailability = null;
    /* The End Time is not filled in yet, but if the Start Time already sits
       inside a Booking the panel should say so rather than reset to the idle
       prompt and contradict the warning the person just saw. */
    const covering = bookingCoveringStart();
    if (covering && roomId && bookingDate && startClock) {
      const room = state.rooms.find(r => r.id === roomId);
      const roomName = room ? room.name : 'This Meeting Room';
      renderAvailability(
        'busy',
        'Unavailable',
        `${roomName} is already booked from ${fmtTime(covering.startTime)} to ${fmtTime(covering.endTime)} for "${covering.meetingTitle}". Pick another Start Time or another Meeting Room.`,
        daySlotsHtml(roomId, bookingDate)
      );
      return;
    }
    renderAvailability('idle', 'Live Availability', 'Choose a Meeting Room, a Date and a time range to see live availability.');
    return;
  }
  if (endClock <= startClock) {
    lastAvailability = null;
    renderAvailability('idle', 'Live Availability', 'End Time must be later than Start Time before availability can be checked.');
    return;
  }

  const ticket = ++availabilityToken;
  renderAvailability('checking', 'Live Availability', 'Checking this Meeting Room for the selected time slot...');

  const query = new URLSearchParams({ roomId, bookingDate, startClock, endClock });
  if (state.editing) query.set('ignoreBookingId', state.editing.id);

  try {
    const result = await api(`/availability?${query.toString()}`);
    if (ticket !== availabilityToken) return;
    lastAvailability = result;
    const slotsHtml = daySlotsHtml(roomId, bookingDate);

    if (result.available) {
      renderAvailability('ok', 'Available', `${result.roomName} is free from ${fmtClockValue(startClock)} to ${fmtClockValue(endClock)} on ${fmtDateValue(bookingDate)}. You can confirm this Booking.`, slotsHtml);
    } else {
      const clash = result.conflicts[0];
      renderAvailability(
        'busy',
        'Unavailable',
        `${result.roomName} is already booked during this time${clash ? ` by ${clash.createdByName} for "${clash.meetingTitle}" from ${fmtTime(clash.startTime)} to ${fmtTime(clash.endTime)}` : ''}. Pick another time or another Meeting Room before confirming.`,
        slotsHtml
      );
    }
  } catch (e) {
    if (ticket !== availabilityToken) return;
    lastAvailability = null;
    renderAvailability('idle', 'Live Availability', e.message || 'Availability could not be checked right now.');
  }
}

/* One dialog for every "this Room is taken" case, always carrying the details
   of the Booking that already holds the slot. */
function conflictListHtml(conflicts) {
  if (!conflicts || !conflicts.length) return '';
  return `<ul class="availability-list" data-testid="conflict-details">
    ${conflicts.map(c => `<li><b>${esc(fmtTime(c.startTime))} to ${esc(fmtTime(c.endTime))}</b> - ${esc(c.meetingTitle)}${c.createdByName ? ` (booked by ${esc(c.createdByName)})` : ''}${c.id ? `<small class="conflict-id">${esc(c.id)}</small>` : ''}</li>`).join('')}
  </ul>`;
}

function showUnavailableDialog(roomName, conflicts, lead) {
  const first = conflicts && conflicts[0];
  const detail = first
    ? `${roomName} is already booked from ${fmtTime(first.startTime)} to ${fmtTime(first.endTime)} for "${first.meetingTitle}"${first.createdByName ? ` by ${first.createdByName}` : ''}.`
    : `${roomName} is already booked during this time.`;
  return alertDialog(
    'Meeting Room Unavailable',
    `${lead ? lead + ' ' : ''}${detail} Choose a different time slot or a different Meeting Room, then confirm again.`,
    { tone: 'warn', listHtml: conflictListHtml(conflicts), closeLabel: 'Change my selection', testid: 'conflict-dialog' }
  );
}

/* A Booking that already covers the chosen Start Time, used to warn the moment
   the person moves on to the End Time rather than making them finish typing. */
function bookingCoveringStart() {
  const roomId = $('roomId') ? $('roomId').value : '';
  const date = $('bookingDate') ? $('bookingDate').value : '';
  const startClock = $('startClock') ? $('startClock').value : '';
  if (!roomId || !date || !/^\d{2}:\d{2}$/.test(startClock)) return null;
  const start = new Date(`${date}T${startClock}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const skipId = state.editing ? state.editing.id : '';
  return state.bookings.find(b =>
    b.roomId === roomId &&
    b.status === 'BOOKED' &&
    b.id !== skipId &&
    new Date(b.startTime) <= start &&
    new Date(b.endTime) > start) || null;
}

function bookedSlotsFor(roomId, date, ignoreId) {
  return state.bookings
    .filter(b => b.roomId === roomId && b.status === 'BOOKED' && b.id !== ignoreId && localParts(b.startTime).date === date)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

/* The list of slots already taken for a Room on a date. Shared by the live
   check and the instant Start Time warning so the panel always looks the same. */
function daySlotsHtml(roomId, date) {
  const slots = bookedSlotsFor(roomId, date, state.editing ? state.editing.id : '');
  if (!slots.length) return '';
  return `
    <ul class="availability-list" data-testid="availability-slots">
      ${slots.map(b => `<li><b>${esc(fmtTime(b.startTime))} to ${esc(fmtTime(b.endTime))}</b> - ${esc(b.meetingTitle)} (${esc(b.createdByName)})</li>`).join('')}
    </ul>
    <p class="availability-foot">Slots already booked for this Meeting Room on ${esc(fmtDateValue(date))}.</p>`;
}

const BOOKING_FIELDS = ['meetingTitle', 'blockId', 'floor', 'roomId', 'bookingDate', 'attendees', 'startClock', 'endClock'];

/* The summary banner is only meaningful while something is still wrong, so it
   disappears the moment the last field error is cleared. */
function refreshBookingAlert() {
  const banner = $('bookingAlert');
  if (!banner || banner.classList.contains('hidden')) return;
  const stillInvalid = BOOKING_FIELDS.some(id => {
    const slot = $(id + 'Error');
    return slot && slot.textContent.trim() !== '';
  });
  if (!stillInvalid) {
    banner.classList.add('hidden');
    banner.textContent = '';
  }
}

/* A stale "already booked" message must not survive a change of time or Room. */
function clearClashFieldError() {
  clearExternalError('roomId');
  validateField('roomId');
}

function wireBook() {
  const min = todayISO();
  $('bookingDate').min = min;
  resetFieldTracking();

  const prefill = state.editing ? null : takePrefill();

  const onBuildingChange = () => {
    markTouched('blockId');
    clearExternalError('blockId');
    clearExternalError('roomId');
    validateField('blockId');
    fillFloors($('blockId').value);
    fillRooms('', '', '');
    updateSummary();
    scheduleAvailabilityCheck();
  };
  const onFloorChange = () => {
    markTouched('floor');
    clearExternalError('floor');
    clearExternalError('roomId');
    validateField('floor');
    fillRooms($('blockId').value, $('floor').value, '');
    updateSummary();
    scheduleAvailabilityCheck();
  };

  $('blockId').onchange = onBuildingChange;
  $('floor').onchange = onFloorChange;

  ['meetingTitle', 'roomId', 'bookingDate', 'attendees', 'startClock', 'endClock'].forEach(id => {
    const eventName = id === 'roomId' ? 'change' : 'input';
    $(id).addEventListener(eventName, () => {
      /* Choosing from a dropdown is a completed action, so it marks the field
         touched. Typing does not: the field stays quiet until it is left. */
      if (eventName === 'change') markTouched(id);
      validateField(id);
      updateSummary();
      /* A message the server produced for this field cannot be recomputed
         locally, so editing the field is what clears it. */
      clearExternalError(id);
      if (['roomId', 'bookingDate', 'startClock', 'endClock'].includes(id)) {
        clearClashFieldError();
        scheduleAvailabilityCheck();
      }
      /* The Booking Date decides whether a Start Time counts as past, so the
         two are revalidated together. */
      if (id === 'bookingDate') { clearExternalError('startClock'); validateField('startClock'); }
      /* Cross-field rules still run, but they can only surface a message on a
         field the person has already visited or on a Confirm attempt. */
      if (id === 'startClock' || id === 'endClock') validateField('endClock');
      if (id === 'roomId') validateField('attendees');
      refreshBookingAlert();
    });
    $(id).addEventListener('blur', () => { markTouched(id); validateField(id); refreshBookingAlert(); });
  });
  $('notes').oninput = updateSummary;

  /* The clash is raised as soon as the person leaves the Start Time and moves
     to the End Time, so they are not asked to finish typing a slot that can
     never be booked. Shown once per Room, Date and Start Time combination. */
  let warnedSlot = '';
  const warnIfStartIsTaken = async () => {
    const clash = bookingCoveringStart();
    if (!clash) { warnedSlot = ''; return; }
    const signature = `${$('roomId').value}|${$('bookingDate').value}|${$('startClock').value}`;
    if (warnedSlot === signature) return;
    warnedSlot = signature;
    const room = state.rooms.find(r => r.id === $('roomId').value);
    const roomName = room ? room.name : 'This Meeting Room';
    setExternalError('roomId', `${roomName} is already booked during this time.`);
    /* Render the same day-slot list the full check uses, so the panel looks
       identical whichever path filled it. */
    renderAvailability(
      'busy',
      'Unavailable',
      `${roomName} is already booked from ${fmtTime(clash.startTime)} to ${fmtTime(clash.endTime)} for "${clash.meetingTitle}". Pick another Start Time or another Meeting Room.`,
      daySlotsHtml($('roomId').value, $('bookingDate').value)
    );
    await showUnavailableDialog(roomName, [clash], 'The Start Time you chose is inside an existing Booking.');
  };

  /* Bound to End Time focus only. A native time input fires change while the
     hour and minute segments are still being typed, so binding to Start Time
     would interrupt the person mid-entry. */
  $('endClock').addEventListener('focus', warnIfStartIsTaken);

  if (state.editing) {
    const b = state.editing;
    const start = localParts(b.startTime);
    const end = localParts(b.endTime);
    $('meetingTitle').value = b.meetingTitle;
    $('blockId').value = b.blockId;
    fillFloors(b.blockId, b.floor);
    fillRooms(b.blockId, b.floor, b.roomId);
    $('bookingDate').value = start.date;
    $('startClock').value = start.time;
    $('endClock').value = end.time;
    $('attendees').value = b.attendees;
    $('notes').value = b.notes || '';
    BOOKING_FIELDS.forEach(markTouched);
    BOOKING_FIELDS.forEach(validateField);
    $('cancelEdit').onclick = () => { state.editing = null; nav('bookings'); };
  } else if (prefill && prefill.blockId) {
    /* Preselect Building, then Floor, then Meeting Room, exactly as a person
       would fill the form by hand. */
    $('blockId').value = prefill.blockId;
    fillFloors(prefill.blockId, prefill.floor);
    if (prefill.floor) fillRooms(prefill.blockId, prefill.floor, prefill.roomId);
    else fillRooms('', '', '');
    if (prefill.roomId && $('roomId').value === prefill.roomId) validateField('roomId');
  }

  $('saveBooking').onclick = saveBooking;
  updateSummary();
  scheduleAvailabilityCheck();

  /* Refresh the Booking list in the background so the instant Start Time check
     and the booked-slot list are judged against current data. */
  api('/bookings').then(rows => {
    if (state.route !== 'book') return;
    state.bookings = rows;
    scheduleAvailabilityCheck();
  }).catch(() => { /* keep the cached list */ });
}

async function saveBooking() {
  clearErrors();
  clearExternalErrors();
  $('bookingAlert').classList.add('hidden');
  /* Pressing Confirm reveals every problem at once, including fields that were
     never visited. */
  submitAttempted = true;
  const valid = BOOKING_FIELDS.map(id => validateField(id)).every(Boolean);
  if (!valid) {
    $('bookingAlert').textContent = 'Please correct the highlighted fields before continuing.';
    $('bookingAlert').classList.remove('hidden');
    revealFirstInvalid();
    return;
  }

  /* Known clash: prompt with a dialog carrying the existing Booking's details
     instead of failing only after submission. */
  if (lastAvailability && lastAvailability.available === false && lastAvailability.roomId === $('roomId').value) {
    setExternalError('roomId', `${lastAvailability.roomName} is already booked during this time.`);
    $('bookingAlert').textContent = `${lastAvailability.roomName} is already booked during this time.`;
    $('bookingAlert').classList.remove('hidden');
    await showUnavailableDialog(lastAvailability.roomName, lastAvailability.conflicts);
    ($('roomId').closest('.field') || $('roomId')).scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  /* An edit changes a Booking other people may already be planning around, so
     it has to carry a reason. Asked last, once the form is known to be valid. */
  let updateComment = '';
  if (state.editing) {
    updateComment = await reasonDialog(
      'Update Booking',
      `Explain what is changing about "${state.editing.meetingTitle}". The reason is kept in the Booking history and is visible to everyone who can see this Booking.`,
      'Reason for Update'
    );
    if (updateComment === null) return;
  }

  const body = {
    meetingTitle: $('meetingTitle').value.trim(),
    blockId: $('blockId').value,
    floor: Number($('floor').value),
    roomId: $('roomId').value,
    bookingDate: $('bookingDate').value,
    startClock: $('startClock').value,
    endClock: $('endClock').value,
    attendees: Number($('attendees').value),
    notes: $('notes').value.trim(),
    updateComment
  };

  $('saveBooking').disabled = true;
  try {
    const editing = state.editing;
    await api(editing ? `/bookings/${editing.id}` : '/bookings', {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    });
    state.editing = null;
    state.bookings = await api('/bookings');
    toast(editing ? 'Booking updated.' : 'Meeting Room booked successfully.');
    nav('bookings');
  } catch (e) {
    const fieldErrors = (e.details && e.details.fieldErrors) || {};
    Object.entries(fieldErrors).forEach(([key, message]) => setExternalError(key, message));
    $('bookingAlert').textContent = e.message;
    $('bookingAlert').classList.remove('hidden');
    const firstServerField = BOOKING_FIELDS.find(id => fieldErrors[id]);
    if (firstServerField && $(firstServerField)) {
      $(firstServerField).focus({ preventScroll: true });
      ($(firstServerField).closest('.field') || $(firstServerField)).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (fieldErrors.roomId && /already booked/i.test(fieldErrors.roomId)) {
      /* Someone else took the slot between the live check and this submit.
         Pull the details so the dialog can still name the Booking. */
      const room = state.rooms.find(r => r.id === body.roomId);
      let conflicts = [];
      try {
        const query = new URLSearchParams({ roomId: body.roomId, bookingDate: body.bookingDate, startClock: body.startClock, endClock: body.endClock });
        if (state.editing) query.set('ignoreBookingId', state.editing.id);
        const result = await api(`/availability?${query.toString()}`);
        conflicts = result.conflicts || [];
      } catch { conflicts = []; }
      try { state.bookings = await api('/bookings'); } catch { /* keep cached list */ }
      await showUnavailableDialog(room ? room.name : 'This Meeting Room', conflicts);
      scheduleAvailabilityCheck();
    }
  } finally {
    if ($('saveBooking')) $('saveBooking').disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * 9. Shared table helpers
 * ------------------------------------------------------------------ */
function compareValue(a, b, key) {
  let x = a[key] == null ? '' : a[key];
  let y = b[key] == null ? '' : b[key];
  if (key === 'amenities') { x = Array.isArray(x) ? x.join(', ') : x; y = Array.isArray(y) ? y.join(', ') : y; }
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
}
function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => compareValue(a, b, key) * (dir === 'asc' ? 1 : -1));
}
function paginate(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  return { items: rows.slice((safePage - 1) * state.pageSize, safePage * state.pageSize), pages, page: safePage };
}
function pager(id, pages, current, onSelect) {
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter(p => p === 1 || p === pages || Math.abs(p - current) <= 1);
  $(id).innerHTML =
    `<button ${current === 1 ? 'disabled' : ''} data-p="${current - 1}" aria-label="Previous page">&lsaquo;</button>` +
    numbers.map(p => `<button class="${p === current ? 'active' : ''}" data-p="${p}">${p}</button>`).join('') +
    `<button ${current === pages ? 'disabled' : ''} data-p="${current + 1}" aria-label="Next page">&rsaquo;</button>`;
  $(id).querySelectorAll('[data-p]').forEach(b => { b.onclick = () => onSelect(Number(b.dataset.p)); });
}
function wireSortHeaders(selector, attr, sortKey, dirKey, rerender) {
  $$(selector).forEach(th => {
    th.dataset.indicator = th.dataset[attr] === state[sortKey] ? (state[dirKey] === 'asc' ? '\u25b2' : '\u25bc') : '';
    th.onclick = () => {
      if (state[sortKey] === th.dataset[attr]) state[dirKey] = state[dirKey] === 'asc' ? 'desc' : 'asc';
      else { state[sortKey] = th.dataset[attr]; state[dirKey] = 'asc'; }
      rerender();
    };
  });
}

/* ------------------------------------------------------------------ *
 * 10. Bookings page
 * ------------------------------------------------------------------ */
function bookingsPage() {
  const admin = isAdmin();
  return `
  <div class="page">
    <div class="page-head">
      <div>
        <span class="eyebrow">Shared Schedule</span>
        <h1 data-testid="page-title">Bookings</h1>
        <p>Bookings created by Admin and User accounts are visible here.</p>
      </div>
      <a class="btn primary" href="#/book" data-testid="bookings-book-cta">Book a Room</a>
    </div>
    <div class="card">
      <div class="toolbar">
        <input id="bookingSearch" data-testid="booking-search" placeholder="Search Bookings" aria-label="Search Bookings" />
        <select id="bookingStatus" data-testid="booking-status">
          <option value="">All Statuses</option>
          <option>BOOKED</option>
          <option>CANCELLED</option>
        </select>
        <span class="result-count" id="bookingCount" data-testid="booking-count"></span>
      </div>
      <div class="table-wrap">
        <table class="data-table" data-testid="bookings-table">
          <thead><tr>
            <th class="sortable" data-sort="meetingTitle">Meeting</th>
            <th class="sortable" data-sort="roomName">Meeting Room</th>
            <th class="sortable" data-sort="startTime">Date &amp; Time</th>
            <th class="sortable" data-sort="createdByName">Booked By</th>
            <th class="sortable" data-sort="status">Status</th>
            ${admin ? '<th>Actions</th>' : ''}
          </tr></thead>
          <tbody id="bookingRows"></tbody>
        </table>
      </div>
      <div id="bookingPagination" class="pagination"></div>
    </div>
  </div>`;
}

function bookingHaystack(b) {
  return [b.meetingTitle, b.roomName, b.roomCode, `${b.roomName} \u00b7 ${b.roomCode}`, b.blockName, `Floor ${b.floor}`, b.createdByName, b.status, b.id].join(' ');
}

function renderBookings() {
  const query = $('bookingSearch').value;
  const status = $('bookingStatus').value;
  let rows = state.bookings.filter(b => (!status || b.status === status) && matchesQuery(bookingHaystack(b), query));
  rows = sortRows(rows, state.bookingSort, state.bookingDir);
  const pg = paginate(rows, state.bookingPage);
  state.bookingPage = pg.page;
  const admin = isAdmin();
  const columns = admin ? 6 : 5;

  $('bookingCount').textContent = `${rows.length} of ${state.bookings.length} Bookings`;
  $('bookingRows').innerHTML = pg.items.length ? pg.items.map(b => `
    <tr data-testid="booking-row" data-booking-id="${esc(b.id)}">
      <td class="booking-name booking-title-cell">
        <button class="table-link clamp-link" title="${esc(b.meetingTitle)}" data-detail="${esc(b.id)}">${esc(b.meetingTitle)}</button>
        <span>${b.attendees} Attendees</span>
      </td>
      <td class="room-name booking-room-cell">
        <button class="table-link clamp-link" title="${esc(b.roomName)} &middot; ${esc(b.roomCode)}" data-detail="${esc(b.id)}">${esc(b.roomName)} &middot; ${esc(b.roomCode)}</button>
        <span>${esc(b.blockName)}, Floor ${b.floor}</span>
      </td>
      <td class="date-cell"><b>${fmt(b.startTime)}</b><small>to ${fmt(b.endTime)}</small></td>
      <td class="booked-by-cell">${esc(b.createdByName)}</td>
      <td>
        <span class="badge ${b.status === 'BOOKED' ? 'success' : 'danger'}">${esc(b.status)}</span>
        ${b.updatedAt ? '<span class="badge edited" data-testid="edited-badge" title="This Booking has been edited. Open it to read the history.">Edited</span>' : ''}
        ${b.status === 'CANCELLED' && b.cancellationComment ? `<small class="audit-inline" data-testid="row-cancel-reason">${esc(b.cancellationComment)}</small>` : ''}
      </td>
      ${admin ? `<td class="actions-cell">${b.status === 'BOOKED'
        ? `<button class="btn secondary sm" data-edit="${esc(b.id)}">Edit</button> <button class="btn ghost sm" data-cancel="${esc(b.id)}">Cancel</button>`
        : '&mdash;'}</td>` : ''}
    </tr>`).join('') : `<tr><td colspan="${columns}" class="empty-cell" data-testid="bookings-empty">No Bookings found.</td></tr>`;

  pager('bookingPagination', pg.pages, pg.page, p => { state.bookingPage = p; renderBookings(); });
  $$('[data-detail]').forEach(x => { x.onclick = () => bookingDetails(x.dataset.detail); });
  $$('[data-edit]').forEach(x => { x.onclick = () => startEdit(x.dataset.edit); });
  $$('[data-cancel]').forEach(x => { x.onclick = () => cancelBooking(x.dataset.cancel); });
  wireSortHeaders('[data-sort]', 'sort', 'bookingSort', 'bookingDir', renderBookings);
}

function wireBookings() {
  $('bookingSearch').oninput = () => { state.bookingPage = 1; renderBookings(); };
  $('bookingStatus').onchange = () => { state.bookingPage = 1; renderBookings(); };
  renderBookings();
}

function startEdit(id) {
  const booking = state.bookings.find(b => b.id === id);
  if (!booking) return;
  state.editing = booking;
  setPrefill(null);
  nav('book');
}

const AUDIT_LABELS = {
  CREATED: 'Created', UPDATED: 'Updated', CANCELLED: 'Cancelled',
  DEACTIVATED: 'Deactivated', ACTIVATED: 'Activated'
};

/* The whole history, newest first, so an earlier reason is never lost behind a
   later one. */
function auditTrailHtml(record) {
  const trail = Array.isArray(record.auditTrail) ? [...record.auditTrail].reverse() : [];
  if (!trail.length) return '<p class="audit-empty" data-testid="audit-empty">No changes have been recorded yet.</p>';
  return `<ol class="audit-trail" data-testid="audit-trail">
    ${trail.map(entry => `
      <li class="audit-entry audit-${esc(String(entry.action).toLowerCase())}" data-audit-action="${esc(entry.action)}">
        <span class="audit-action">${esc(AUDIT_LABELS[entry.action] || entry.action)}</span>
        <b class="audit-comment">${esc(entry.comment || 'No comment recorded.')}</b>
        <small class="audit-meta">${esc(entry.byName)} &middot; ${fmt(entry.at)}</small>
      </li>`).join('')}
  </ol>`;
}

function bookingDetails(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  const canAct = b.status === 'BOOKED' && (isAdmin() || b.createdBy === currentUserId());
  openDialog(`
    <div class="modal-backdrop" data-testid="modal-backdrop">
      <div class="modal detail-modal" role="dialog" aria-modal="true" data-testid="booking-detail">
        <div class="detail-head">
          <div><span class="eyebrow">Booking Details</span><h3>${esc(b.meetingTitle)}</h3></div>
          <button class="icon-close" id="detailClose" aria-label="Close">&times;</button>
        </div>
        <div class="detail-grid">
          <div><span>Booking ID</span><b>${esc(b.id)}</b></div>
          <div><span>Status</span><b><span class="badge ${b.status === 'BOOKED' ? 'success' : 'danger'}">${esc(b.status)}</span></b></div>
          <div><span>Meeting Room</span><b>${esc(b.roomName)} &middot; ${esc(b.roomCode)}</b></div>
          <div><span>Location</span><b>${esc(b.blockName)} &middot; Floor ${b.floor}</b></div>
          <div><span>Start</span><b>${fmt(b.startTime)}</b></div>
          <div><span>End</span><b>${fmt(b.endTime)}</b></div>
          <div><span>Attendees</span><b>${b.attendees}</b></div>
          <div><span>Booked By</span><b>${esc(b.createdByName)}</b></div>
          <div class="full"><span>Notes</span><b>${esc(b.notes || 'No notes provided.')}</b></div>
          ${b.cancellationComment ? `<div class="full audit-note"><span>Cancellation Comment</span><b>${esc(b.cancellationComment)}</b><small>Cancelled by ${esc(b.cancelledByName || 'User')} - ${fmt(b.cancelledAt)}</small></div>` : ''}
        </div>
        <div class="audit-section">
          <span class="eyebrow">Booking History</span>
          ${auditTrailHtml(b)}
        </div>
        <div class="modal-actions">
          ${canAct ? '<button class="btn secondary" id="detailEdit" data-testid="detail-edit">Edit Booking</button><button class="btn danger" id="detailCancel" data-testid="detail-cancel">Cancel Booking</button>' : ''}
          <button class="btn ghost" id="detailDone" data-testid="detail-close">Close</button>
        </div>
      </div>
    </div>`);
  $('detailClose').onclick = closeModal;
  $('detailDone').onclick = closeModal;
  if (canAct) {
    $('detailEdit').onclick = () => { closeModal(); startEdit(id); };
    $('detailCancel').onclick = async () => { closeModal(); await cancelBooking(id); };
  }
}

async function cancelBooking(id) {
  const booking = state.bookings.find(x => x.id === id);
  const title = booking ? booking.meetingTitle : 'this Booking';
  const ownBooking = !!booking && booking.createdBy === currentUserId();
  /* Both roles give a reason, but the wording is honest about whose Booking it
     is: an Administrator is explaining an action taken on someone else's
     Booking, a Standard User is recording why they dropped their own. */
  const description = ownBooking
    ? `Record why "${title}" is no longer needed. The Meeting Room becomes available immediately and the reason is kept in the Booking history.`
    : `Explain why "${title}" is being cancelled. ${booking ? esc(booking.createdByName) : 'The owner'} will see this reason in the Booking history.`;
  const reason = await reasonDialog('Cancel Booking', description, 'Cancellation Comment');
  if (reason === null) return;
  try {
    await api(`/bookings/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
    state.bookings = await api('/bookings');
    if (state.route === 'bookings') renderBookings();
    else render();
    toast('Booking cancelled.');
  } catch (e) {
    await alertDialog('Booking could not be cancelled', e.message, { tone: 'warn' });
  }
}

/* ------------------------------------------------------------------ *
 * 11. Meeting Rooms page - available to Administrator and Standard User
 * ------------------------------------------------------------------ */
function roomsPage() {
  const admin = isAdmin();
  return `
  <div class="page">
    <div class="page-head">
      <div>
        <span class="eyebrow">${admin ? 'Room Administration' : 'Room Directory'}</span>
        <h1 data-testid="page-title">Meeting Rooms</h1>
        <p>Browse ${state.rooms.length} Meeting Rooms with search, filtering, sorting and pagination. Use <b>Book</b> on any row to open the Booking form with that Room already selected.</p>
      </div>
      <a class="btn primary" href="#/book" data-testid="rooms-book-cta">Book a Room</a>
    </div>
    <div class="card">
      <div class="toolbar">
        <input id="roomSearch" data-testid="room-search" placeholder="Search Meeting Rooms" aria-label="Search Meeting Rooms" />
        <select id="roomBuilding" data-testid="room-building">
          <option value="">All Buildings</option>
          ${state.blocks.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
        </select>
        <select id="roomStatus" data-testid="room-status">
          <option value="">All Statuses</option>
          <option>ACTIVE</option>
          <option>INACTIVE</option>
        </select>
        <span class="result-count" id="roomCount" data-testid="room-count"></span>
      </div>
      <div class="table-wrap">
        <table class="data-table" data-testid="rooms-table">
          <thead><tr>
            <th class="sortable" data-room-sort="name">Meeting Room</th>
            <th class="sortable" data-room-sort="blockName">Building</th>
            <th class="sortable" data-room-sort="floor">Floor</th>
            <th class="sortable" data-room-sort="capacity">Capacity</th>
            <th class="sortable" data-room-sort="amenities">Amenities</th>
            <th class="sortable" data-room-sort="status">Status</th>
            <th>Book</th>
            ${admin ? '<th>Action</th>' : ''}
          </tr></thead>
          <tbody id="roomRows"></tbody>
        </table>
      </div>
      <div id="roomPagination" class="pagination"></div>
    </div>
  </div>`;
}

/* The latest status change, so the Rooms table explains itself without a
   second click, whether the Room was taken out of service or returned to it. */
function roomStatusNote(room) {
  const trail = Array.isArray(room.auditTrail) ? room.auditTrail : [];
  const last = trail[trail.length - 1];
  if (room.status === 'INACTIVE') {
    const reason = room.deactivationComment || (last && last.comment) || '';
    return reason ? `<small class="audit-inline" data-testid="room-status-note">${esc(reason)}</small>` : '';
  }
  if (last && last.action === 'ACTIVATED') {
    return `<small class="audit-inline muted-note" data-testid="room-status-note">${esc(last.comment)} ${esc(fmt(last.at))}</small>`;
  }
  return '';
}

function roomHaystack(r) {
  return [r.name, r.code, `${r.name} \u00b7 ${r.code}`, r.blockName, `Floor ${r.floor}`, r.id, r.status, (r.amenities || []).join(' ')].join(' ');
}

function renderRooms() {
  const query = $('roomSearch').value;
  const building = $('roomBuilding').value;
  const status = $('roomStatus').value;
  const admin = isAdmin();

  let rows = state.rooms.filter(r =>
    (!building || r.blockId === building) &&
    (!status || r.status === status) &&
    matchesQuery(roomHaystack(r), query));
  rows = sortRows(rows, state.roomSort, state.roomDir);
  const pg = paginate(rows, state.roomPage);
  state.roomPage = pg.page;
  const columns = admin ? 8 : 7;

  $('roomCount').textContent = `${rows.length} of ${state.rooms.length} Meeting Rooms`;
  $('roomRows').innerHTML = pg.items.length ? pg.items.map(r => `
    <tr data-testid="room-row" data-room-id="${esc(r.id)}">
      <td class="room-name">
        <a class="table-link" href="#/book" data-book-room="${esc(r.id)}" title="Book ${esc(r.name)}">${esc(r.name)} &middot; ${esc(r.code)}</a>
        <span>${esc(r.id)}</span>
      </td>
      <td>${esc(r.blockName)}</td>
      <td>${r.floor}</td>
      <td>${r.capacity}</td>
      <td>${esc((r.amenities || []).join(', '))}</td>
      <td>
        <span class="badge ${r.status === 'ACTIVE' ? 'success' : 'danger'}">${esc(r.status)}</span>
        ${roomStatusNote(r)}
      </td>
      <td class="actions-cell">
        ${r.status === 'ACTIVE'
          ? `<a class="btn secondary sm" href="#/book" data-book-room="${esc(r.id)}" data-testid="book-room-${esc(r.id)}">Book</a>`
          : '<span class="muted-note" title="Inactive Meeting Rooms cannot be booked">Unavailable</span>'}
      </td>
      ${admin ? `<td class="actions-cell">
        <button class="btn ${r.status === 'ACTIVE' ? 'ghost' : 'secondary'} sm" data-room="${esc(r.id)}" data-status="${r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}">${r.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
      </td>` : ''}
    </tr>`).join('') : `<tr><td colspan="${columns}" class="empty-cell" data-testid="rooms-empty">No Meeting Rooms found.</td></tr>`;

  pager('roomPagination', pg.pages, pg.page, p => { state.roomPage = p; renderRooms(); });
  $$('[data-book-room]').forEach(link => {
    link.onclick = e => {
      /* Modifier clicks are left to the browser so the link can open in a new
         tab; the preselection is stored first so the new tab also prefills. */
      const room = state.rooms.find(r => r.id === link.dataset.bookRoom);
      if (!room) return;
      setPrefill({ blockId: room.blockId, floor: room.floor, roomId: room.id });
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      state.editing = null;
      nav('book');
    };
  });
  $$('[data-room]').forEach(btn => { btn.onclick = () => setRoomStatus(btn.dataset.room, btn.dataset.status); });
  wireSortHeaders('[data-room-sort]', 'roomSort', 'roomSort', 'roomDir', renderRooms);
}

function wireRooms() {
  $('roomSearch').oninput = () => { state.roomPage = 1; renderRooms(); };
  $('roomBuilding').onchange = () => { state.roomPage = 1; renderRooms(); };
  $('roomStatus').onchange = () => { state.roomPage = 1; renderRooms(); };
  renderRooms();
}

function futureBookingsForRoom(roomId) {
  const now = new Date();
  return state.bookings.filter(b => b.roomId === roomId && b.status === 'BOOKED' && new Date(b.endTime) > now);
}

function blockingBookingsHtml(list) {
  if (!list.length) return '';
  return `<ul class="availability-list" data-testid="blocking-bookings">
    ${list.map(b => `<li><b>${esc(b.meetingTitle)}</b> - ${esc(fmt(b.startTime))} to ${esc(fmtTime(b.endTime))}</li>`).join('')}
  </ul>`;
}

async function setRoomStatus(id, status) {
  const room = state.rooms.find(r => r.id === id);
  if (!room) return;

  if (status === 'INACTIVE') {
    /* Refresh first so the check is made against current data. */
    try { state.bookings = await api('/bookings'); } catch { /* keep cached list */ }
    const blocking = futureBookingsForRoom(id);
    if (blocking.length) {
      const openBookings = await alertDialog(
        'Deactivate Meeting Room',
        'This Meeting Room still has an active future Booking. Open Bookings, cancel the active Booking with a Cancellation Comment, then retry deactivation.',
        { tone: 'warn', listHtml: blockingBookingsHtml(blocking), actionLabel: 'Open Bookings', closeLabel: 'Close', testid: 'room-blocked-dialog' }
      );
      if (openBookings) nav('bookings');
      return;
    }
    const reason = await reasonDialog(
      'Deactivate Meeting Room',
      'Provide the operational reason for taking this Meeting Room out of service. The comment is stored in the audit history.',
      'Deactivation Comment'
    );
    if (reason === null) return;
    await patchRoom(id, 'INACTIVE', reason);
    return;
  }

  const confirmed = await modal('Activate Meeting Room', 'Make this Meeting Room available for new Bookings?', 'Activate');
  if (!confirmed) return;
  await patchRoom(id, 'ACTIVE', '');
}

async function patchRoom(id, status, reason) {
  try {
    await api(`/rooms/${id}`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
    state.rooms = await api('/rooms');
    state.bookings = await api('/bookings');
    renderRooms();
    toast(`Meeting Room marked ${status}.`);
  } catch (e) {
    if (e.code === 'ROOM_HAS_FUTURE_BOOKINGS') {
      const list = (e.details && e.details.bookings) || [];
      const openBookings = await alertDialog(
        'Deactivate Meeting Room',
        'This Meeting Room still has an active future Booking. Open Bookings, cancel the active Booking with a Cancellation Comment, then retry deactivation.',
        { tone: 'warn', listHtml: blockingBookingsHtml(list), actionLabel: 'Open Bookings', closeLabel: 'Close', testid: 'room-blocked-dialog' }
      );
      if (openBookings) nav('bookings');
      return;
    }
    await alertDialog('Meeting Room could not be updated', e.message, { tone: 'warn' });
  }
}

/* ------------------------------------------------------------------ *
 * 12. Automation Playground
 * ------------------------------------------------------------------ */
function playgroundPage(guest) {
  return `
  <div class="page">
    <div class="page-head">
      <div>
        <span class="eyebrow">Automation Practice</span>
        <h1 data-testid="page-title">UI Automation Playground</h1>
        <p>Practice Forms, Keyboard, Mouse, Dialogs, Dynamic Content, File Upload and Download, Windows, Frames, Tables and Shadow DOM.</p>
      </div>
      <div class="play-row">
        ${guest ? '<a class="btn primary" href="#/dashboard" data-testid="playground-sign-in">Sign In</a>' : ''}
        <a class="btn secondary" href="/docs" target="_blank" rel="noopener" data-testid="playground-api-docs">Open the API Docs</a>
      </div>
    </div>
    ${guest ? '<div class="alert info" data-testid="playground-guest-note">You are browsing the Playground without signing in. Every widget below works. Sign In to reach Bookings and Meeting Rooms.</div>' : ''}
    <div class="play-grid">

      <div class="card play-card">
        <h3>Typing &amp; Keyboard</h3>
        <input id="pgInput" data-testid="pg-input" placeholder="Type and press Enter" />
        <div id="pgTyping" class="play-output play-output-stack" data-testid="pg-typing">
          <div data-testid="pg-text-entered" id="pgTextEntered">Text Entered: (nothing yet)</div>
          <div data-testid="pg-last-key" id="pgLastKey">Last Key: (none)</div>
        </div>
      </div>

      <div class="card play-card">
        <h3>Choices</h3>
        <label><input class="pgCheck" type="checkbox" value="Smoke" data-testid="pg-check-smoke" /> Smoke</label>
        <label><input class="pgCheck" type="checkbox" value="Regression" data-testid="pg-check-regression" /> Regression</label>
        <br />
        <label><input name="level" class="pgRadio" type="radio" value="Beginner" data-testid="pg-radio-beginner" /> Beginner</label>
        <label><input name="level" class="pgRadio" type="radio" value="Pro" data-testid="pg-radio-pro" /> Pro</label>
        <select id="pgSelect" data-testid="pg-select">
          <option value="">Select Framework</option>
          <option>Playwright</option>
          <option>Selenium</option>
        </select>
        <div id="pgChoices" class="play-output" data-testid="pg-choices">Nothing selected</div>
      </div>

      <div class="card play-card">
        <h3>Mouse Actions</h3>
        <div class="play-row">
          <button id="pgClick" class="btn secondary" data-testid="pg-click">Single Click</button>
          <button id="pgDouble" class="btn secondary" data-testid="pg-double">Double Click</button>
          <button id="pgContext" class="btn secondary" data-testid="pg-context">Right Click</button>
          <button id="pgHover" class="btn secondary" title="Hover Tooltip" data-testid="pg-hover">Hover</button>
        </div>
        <div id="pgMouse" class="play-output" data-testid="pg-mouse">No mouse action yet.</div>
      </div>

      <div class="card play-card">
        <h3>Dialogs</h3>
        <div class="play-row">
          <button id="pgAlert" class="btn secondary" data-testid="pg-alert">Alert</button>
          <button id="pgConfirm" class="btn secondary" data-testid="pg-confirm">Confirm</button>
          <button id="pgPrompt" class="btn secondary" data-testid="pg-prompt">Prompt</button>
        </div>
        <div id="pgDialogs" class="play-output" data-testid="pg-dialogs">No dialog result yet.</div>
      </div>

      <div class="card play-card">
        <h3>Drag &amp; Drop</h3>
        <span id="pgDrag" class="drag-item" draggable="true" data-testid="pg-drag">Drag Me</span>
        <div id="pgDrop" class="drop-zone" data-testid="pg-drop">Drop Here</div>
        <div id="pgDropOut" class="play-output" data-testid="pg-drop-output">Nothing dropped yet.</div>
      </div>

      <div class="card play-card">
        <h3>Dynamic Loading &amp; Visibility</h3>
        <div class="progress"><span id="pgProgress"></span></div>
        <div class="play-row">
          <button id="pgLoad" class="btn secondary" data-testid="pg-load">Load Content</button>
          <button id="pgToggle" class="btn secondary" data-testid="pg-toggle">Toggle Visibility</button>
        </div>
        <div id="pgDynamic" class="play-output" data-testid="pg-dynamic">Dynamic content is visible.</div>
      </div>

      <div class="card play-card">
        <h3>File Input, Download &amp; Slider</h3>

        <label class="play-label" for="pgFile">Upload a file</label>
        <input id="pgFile" type="file" data-testid="pg-file" />
        <div id="pgFileOut" class="play-output" data-testid="pg-file-output">No file selected.</div>

        <label class="play-label">Download a file</label>
        <div class="play-row">
          <a class="btn secondary" id="pgDownloadStatic" href="/sample-meeting-rooms.csv" download="sample-meeting-rooms.csv" data-testid="pg-download-link">Download CSV (static link)</a>
          <button class="btn secondary" id="pgDownloadTxt" data-testid="pg-download-txt">Download TXT (generated)</button>
          <button class="btn secondary" id="pgDownloadJson" data-testid="pg-download-json">Download JSON (generated)</button>
        </div>
        <div id="pgDownloadOut" class="play-output" data-testid="pg-download-output">No download triggered yet.</div>

        <label class="play-label" for="pgRange">Slider</label>
        <input id="pgRange" type="range" min="0" max="100" value="50" data-testid="pg-range" />
        <div id="pgRangeOut" class="play-output" data-testid="pg-slider-output">Slider: 50</div>
      </div>

      <div class="card play-card">
        <h3>Windows &amp; Frames</h3>
        <div class="play-row">
          <button id="pgPopup" class="btn secondary" data-testid="pg-popup">Open Popup</button>
          <a class="btn secondary" id="pgNewTab" href="/docs" target="_blank" rel="noopener" data-testid="pg-new-tab">New Tab</a>
        </div>
        <iframe id="pgFrame" title="Playground Frame" data-testid="pg-frame" srcdoc="<button id='frameButton' style='font:inherit;padding:8px 14px;border:1px solid #dfe5ef;border-radius:8px;background:#fff;cursor:pointer'>Frame Button</button><span id='frameOut' style='font:inherit;margin-left:10px;color:#69738b'>Not clicked yet.</span><script>document.getElementById('frameButton').addEventListener('click',function(){document.getElementById('frameOut').textContent='Frame Button clicked.';parent.postMessage({source:'mss-playground-frame',message:'Frame Button clicked.'},'*');});<\/script>" style="width:100%;height:80px;border:1px solid #dfe5ef;border-radius:10px;margin-top:10px"></iframe>
        <div id="pgWindowOut" class="play-output" data-testid="pg-window-output">No window action yet.</div>
      </div>

      <div class="card play-card">
        <h3>Editable Data Table</h3>
        <div class="play-row">
          <input id="pgRowInput" data-testid="pg-row-input" placeholder="New Row" />
          <button id="pgRowAdd" class="btn secondary" data-testid="pg-row-add">Add Row</button>
        </div>
        <table class="data-table" data-testid="pg-table">
          <tbody id="pgTbody"><tr><td>Playwright</td><td><button class="btn ghost sm pgRemove">Remove</button></td></tr></tbody>
        </table>
        <div id="pgTableOut" class="play-output" data-testid="pg-table-output">1 row. No change yet.</div>
      </div>

      <div class="card play-card">
        <h3>Shadow DOM</h3>
        <div id="pgShadowHost" data-testid="pg-shadow-host"></div>
        <div id="pgShadowOut" class="play-output" data-testid="pg-shadow-output">Shadow DOM Button not clicked yet.</div>
      </div>

    </div>
  </div>`;
}

function triggerDownload(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function wirePlayground() {
  /* Typing and Keyboard: both readings stay on screen at the same time. */
  const textOut = $('pgTextEntered');
  const keyOut = $('pgLastKey');
  $('pgInput').addEventListener('keydown', e => { keyOut.textContent = `Last Key: ${e.key}`; });
  $('pgInput').addEventListener('input', e => { textOut.textContent = `Text Entered: ${e.target.value || '(nothing yet)'}`; });

  $$('.pgCheck,.pgRadio').forEach(x => {
    x.onchange = () => {
      const selected = $$('.pgCheck:checked,.pgRadio:checked').map(v => v.value);
      $('pgChoices').textContent = selected.length ? selected.join(', ') : 'Nothing selected';
    };
  });
  $('pgSelect').onchange = e => { $('pgChoices').textContent = `Framework: ${e.target.value || 'none'}`; };

  $('pgClick').onclick = () => { $('pgMouse').textContent = 'Single Click recorded.'; };
  $('pgDouble').ondblclick = () => { $('pgMouse').textContent = 'Double Click recorded.'; };
  $('pgContext').oncontextmenu = e => { e.preventDefault(); $('pgMouse').textContent = 'Right Click recorded.'; };
  $('pgHover').onmouseenter = () => { $('pgMouse').textContent = 'Hover recorded.'; };

  $('pgAlert').onclick = () => { window.alert('Playground Alert'); $('pgDialogs').textContent = 'Alert acknowledged.'; };
  $('pgConfirm').onclick = () => { $('pgDialogs').textContent = window.confirm('Confirm this action?') ? 'Confirmed.' : 'Cancelled.'; };
  $('pgPrompt').onclick = () => { $('pgDialogs').textContent = `Prompt: ${window.prompt('Enter a value') || '(empty)'}`; };

  const drag = $('pgDrag');
  const drop = $('pgDrop');
  drag.ondragstart = e => {
    e.dataTransfer.setData('text/plain', 'item');
    $('pgDropOut').textContent = 'Drag started.';
  };
  drag.ondragend = () => {
    if ($('pgDropOut').textContent === 'Drag started.') $('pgDropOut').textContent = 'Drag cancelled.';
  };
  drop.ondragover = e => e.preventDefault();
  drop.ondrop = e => {
    e.preventDefault();
    drop.textContent = 'Dropped Successfully';
    $('pgDropOut').textContent = 'Drag and Drop completed.';
  };

  $('pgLoad').onclick = () => {
    let p = 0;
    $('pgDynamic').textContent = 'Loading...';
    const timer = setInterval(() => {
      p += 10;
      $('pgProgress').style.width = p + '%';
      if (p >= 100) { clearInterval(timer); $('pgDynamic').textContent = 'Dynamic Content loaded.'; }
    }, 80);
  };
  $('pgToggle').onclick = () => $('pgDynamic').classList.toggle('hidden');

  $('pgFile').onchange = e => {
    const file = e.target.files[0];
    $('pgFileOut').textContent = file ? `File: ${file.name} (${file.size} bytes)` : 'No file selected.';
  };

  $('pgDownloadStatic').onclick = () => { $('pgDownloadOut').textContent = 'Download started: sample-meeting-rooms.csv'; };
  $('pgDownloadTxt').onclick = () => {
    triggerDownload('meetspacesync-notes.txt', 'text/plain;charset=utf-8',
      `MeetSpaceSync Playground\nGenerated: ${new Date().toISOString()}\nMeeting Rooms: ${state.rooms.length}\nBookings: ${state.bookings.length}\n`);
    $('pgDownloadOut').textContent = 'Download started: meetspacesync-notes.txt';
  };
  $('pgDownloadJson').onclick = () => {
    const sample = state.rooms.slice(0, 5).map(r => ({ id: r.id, name: r.name, code: r.code, building: r.blockName, floor: r.floor, capacity: r.capacity }));
    triggerDownload('meetspacesync-rooms.json', 'application/json;charset=utf-8', JSON.stringify(sample, null, 2));
    $('pgDownloadOut').textContent = 'Download started: meetspacesync-rooms.json';
  };

  $('pgRange').oninput = e => { $('pgRangeOut').textContent = `Slider: ${e.target.value}`; };

  $('pgPopup').onclick = () => {
    window.open('/docs', 'mssPopup', 'width=880,height=680');
    $('pgWindowOut').textContent = 'Popup opened.';
  };
  $('pgNewTab').onclick = () => { $('pgWindowOut').textContent = 'New Tab opened.'; };

  /* The frame button lives in another document, so it reports back by message. */
  if (window.__mssFrameListener) window.removeEventListener('message', window.__mssFrameListener);
  window.__mssFrameListener = event => {
    if (!event.data || event.data.source !== 'mss-playground-frame') return;
    if ($('pgWindowOut')) $('pgWindowOut').textContent = event.data.message;
  };
  window.addEventListener('message', window.__mssFrameListener);

  const rowCount = () => $('pgTbody').querySelectorAll('tr').length;
  const reportRows = message => { $('pgTableOut').textContent = `${rowCount()} row${rowCount() === 1 ? '' : 's'}. ${message}`; };
  const removeRow = tr => { const label = tr.firstElementChild.textContent; tr.remove(); reportRows(`Removed "${label}".`); };

  $('pgRowAdd').onclick = () => {
    const value = $('pgRowInput').value.trim();
    if (!value) {
      /* Silently ignoring an empty Add Row leaves nothing to assert against. */
      $('pgTableOut').textContent = `${rowCount()} row${rowCount() === 1 ? '' : 's'}. Enter a value before adding a row.`;
      $('pgRowInput').focus();
      return;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(value)}</td><td><button class="btn ghost sm pgRemove">Remove</button></td>`;
    $('pgTbody').append(tr);
    tr.querySelector('button').onclick = () => removeRow(tr);
    $('pgRowInput').value = '';
    reportRows(`Added "${value}".`);
  };
  $$('.pgRemove').forEach(btn => { btn.onclick = () => removeRow(btn.closest('tr')); });

  const host = $('pgShadowHost');
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.innerHTML = '<button id="shadowButton">Shadow Button</button>';
  root.getElementById('shadowButton').onclick = () => { $('pgShadowOut').textContent = 'Shadow DOM Button clicked.'; };
}

/* ------------------------------------------------------------------ *
 * 13. Settings drawer - same controls and test ids as the API Docs
 * ------------------------------------------------------------------ */
function openDrawer() {
  $('drawer').classList.add('open');
  $('drawerScrim').classList.add('open');
  $('baseUrl').value = state.base;
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawerScrim').classList.remove('open');
}
function drawerBase() {
  const value = $('baseUrl').value.trim().replace(/\/+$/, '');
  return value || '/api';
}

function wireDrawer() {
  $('gearBtn').onclick = openDrawer;
  $('drawerClose').onclick = closeDrawer;
  $('drawerScrim').onclick = closeDrawer;

  $('testApiBtn').onclick = async () => {
    const out = $('pingStatus');
    out.className = 'd-status';
    out.textContent = 'Checking...';
    state.base = drawerBase();
    localStorage.setItem('mss-base', state.base);
    try {
      const ping = await api('/ping');
      out.className = 'd-status ok connection-indicator';
      out.textContent = `Connected to ${ping.app} ${ping.version} - ${ping.rooms} Meeting Rooms, API is responding normally.`;
      toast('Connection successful.');
    } catch (e) {
      out.className = 'd-status err';
      out.textContent = `Cannot reach ${state.base}. Is the server running? (${e.message})`;
      toast(e.message, 'error');
    }
  };

  $('resetBtn').onclick = async () => {
    const out = $('resetStatus');
    if (!state.user) {
      out.className = 'd-status err';
      out.textContent = 'Sign in as Administrator before resetting the demo data.';
      return;
    }
    if (!isAdmin()) {
      out.className = 'd-status err';
      out.textContent = 'Administrator access is required to reset the demo data.';
      toast('Sign In as Admin to reset Demo Data.', 'error');
      return;
    }
    const confirmed = await modal('Reset Demo Data', 'This permanently removes all Bookings and restores the seeded Meeting Rooms.', 'Reset Now', true);
    if (!confirmed) return;
    out.className = 'd-status';
    out.textContent = 'Resetting...';
    try {
      const result = await api('/reset', { method: 'POST' });
      await preload();
      out.className = 'd-status ok connection-indicator';
      out.textContent = `Reset complete - ${result.rooms} Meeting Rooms restored and all demo Bookings cleared.`;
      closeDrawer();
      nav('dashboard');
      render();
      toast('Demo Data restored.');
    } catch (e) {
      out.className = 'd-status err';
      out.textContent = `Reset failed: ${e.message}`;
    }
  };

  $('credsBtn').onclick = () => {
    const area = $('credsArea');
    area.hidden = !area.hidden;
    $('credsBtn').textContent = area.hidden ? 'Show credentials' : 'Hide credentials';
  };

  const COPY = {
    'copy-admin': 'admin / admin123',
    'copy-user': 'user / user123',
    'copy-apikey': 'meetspacesync-key-2026',
    'copy-basic': 'meetspace / basic123'
  };
  Object.keys(COPY).forEach(testid => {
    const btn = document.querySelector(`[data-testid="${testid}"]`);
    if (!btn) return;
    btn.onclick = () => {
      const done = () => {
        const label = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = label; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(COPY[testid]).then(done, done);
      else done();
    };
  });
}

/* ------------------------------------------------------------------ *
 * 14. Startup wiring
 * ------------------------------------------------------------------ */
$('loginButton').onclick = signIn;
['username', 'password'].forEach(id => {
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
});
$('togglePassword').onclick = () => {
  $('password').classList.toggle('masked');
  $('togglePassword').textContent = $('password').classList.contains('masked') ? 'Show' : 'Hide';
};
$$('[data-fill]').forEach(btn => {
  btn.onclick = () => {
    const admin = btn.dataset.fill === 'admin';
    $('username').value = admin ? 'admin' : 'user';
    $('password').value = admin ? 'admin123' : 'user123';
  };
});
$('logout').onclick = signOut;

/* Clicking the header link for the page you are already on should still do
   something useful: re-render it fresh. Modifier clicks are left alone so the
   link can still be opened in a new tab. */
$$('a[data-route]').forEach(link => {
  link.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (normalizeRoute(location.hash) !== link.dataset.route) return;
    e.preventDefault();
    state.editing = null;
    setPrefill(null);
    applyRoute();
  });
});

/* Explore buttons on the Overview page live inside re-rendered markup. */
document.addEventListener('click', e => {
  const explore = e.target.closest('[data-explore]');
  if (!explore) return;
  setPrefill({ blockId: explore.dataset.explore });
  state.editing = null;
  nav('book');
});

wireDrawer();
restore();
