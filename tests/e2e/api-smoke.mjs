// End-to-end API test against a running API with a freshly seeded demo clinic.
// Covers the roles matrix, every feature's happy path and its main failure cases, and tenant isolation.
// It changes the demo data, so reset the database afterwards:
//   node tests/e2e/api-smoke.mjs [http://localhost:5117]
const BASE = (process.argv[2] ?? 'http://localhost:5117') + '/api';

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}

/** A browser-like client with its own cookie jar. */
class Client {
  cookie = '';
  async req(method, path, body, { csrf = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-Chairside-Csrf'] = '1';
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (/^(__Host-)?chairside\.auth=/.test(c)) this.cookie = c.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
  put = (p, b) => this.req('PUT', p, b);
  del = (p) => this.req('DELETE', p);
}

async function as(persona) {
  const c = new Client();
  const r = await c.post('/auth/demo', { persona });
  if (r.status !== 200) throw new Error(`demo sign-in as ${persona} failed: ${r.status}`);
  c.me = r.body;
  return c;
}

const expectStatus = (name, r, status) => check(name, r.status === status, `expected ${status}, got ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ---------- A. Authentication ----------
const anon = new Client();
expectStatus('A1 config is public', await anon.get('/auth/config'), 200);
expectStatus('A2 me without sign-in is 401', await anon.get('/auth/me'), 401);
expectStatus('A3 POST without CSRF header is rejected', await anon.req('POST', '/auth/login', { email: 'a@b.c', password: 'x' }, { csrf: false }), 400);
const badLogin = await anon.post('/auth/login', { email: 'nobody@nowhere.test', password: 'wrong password' });
expectStatus('A4 wrong password is 400', badLogin, 400);
check('A5 wrong password error is on the password field', !!badLogin.body?.errors?.password);
expectStatus('A6 unknown demo persona is 400', await anon.post('/auth/demo', { persona: 'dentist' }), 400);
expectStatus('A6b signed-out session probe is 204, not an error', await anon.get('/auth/session'), 204);

const owner = await as('owner');
const manager = await as('manager');
const hygienist = await as('hygienist');
const reception = await as('reception');
check('A7 owner role', owner.me.role === 'owner_admin');
check('A8 manager role and home', manager.me.role === 'practice_manager' && manager.me.homeLocationName === 'Downtown');
check('A9 hygienist role', hygienist.me.role === 'clinical_staff' && hygienist.me.jobTitle === 'Hygienist');
check('A10 reception role', reception.me.role === 'reception');
const sess = await hygienist.get('/auth/session');
check('A10b session returns the person and lookups together', sess.status === 200 && sess.body?.me?.staffId === hygienist.me.staffId && sess.body?.lookups?.locations?.length === 2);
const temp = await as('reception');
expectStatus('A11 logout', await temp.post('/auth/logout'), 204);
expectStatus('A12 me after logout is 401', await temp.get('/auth/me'), 401);

const lookups = (await owner.get('/clinic/lookups')).body;
const loc = Object.fromEntries(lookups.locations.map((l) => [l.name, l.id]));
const titles = Object.fromEntries(lookups.jobTitles.map((j) => [j.name, j.id]));
const defs = Object.fromEntries(lookups.shiftDefinitions.map((d) => [d.name, d]));
const directory = (await owner.get('/staff?search=&includeInactive=true')).body;
const sid = (first) => directory.find((s) => s.name.startsWith(first + ' ')).staffId;
check('A13 lookups have 2 locations, 6 job titles, 3 shift types, 3 credential types',
  lookups.locations.length === 2 && lookups.jobTitles.length === 6 && lookups.shiftDefinitions.length === 3 && lookups.credentialTypes.length === 3);
check('A14 directory has 16 people', directory.length === 16, `got ${directory.length}`);

// ---------- B. Roles matrix ----------
// Valid bodies, so these prove the permission check and not just input validation.
const validStaff = (first) => ({ firstName: first, lastName: 'Probe', email: first.toLowerCase() + '.probe@brightsmiles.test', phone: null, jobTitleId: titles['Dental assistant'], homeLocationId: loc.Downtown, startDate: '2026-01-05', overtimeEligible: true, employmentType: 'full_time', pattern: [] });
for (const [who, c] of [['reception', reception], ['hygienist', hygienist]]) {
  expectStatus(`B ${who}: dashboard 403`, await c.get('/dashboard'), 403);
  expectStatus(`B ${who}: leave inbox 403`, await c.get('/leave/inbox'), 403);
  expectStatus(`B ${who}: audit 403`, await c.get('/audit?entity=&page=0'), 403);
  expectStatus(`B ${who}: billing 403`, await c.get('/clinic/billing'), 403);
  expectStatus(`B ${who}: attendance list 403`, await c.get(`/attendance?locationId=${loc.Downtown}`), 403);
  expectStatus(`B ${who}: create staff 403`, await c.post('/staff', validStaff(who)), 403);
  expectStatus(`B ${who}: other location schedule 403`, await c.get(`/schedule?locationId=${loc.Riverside}`), 403);
  const w = await c.get('/schedule');
  expectStatus(`B ${who}: own schedule 200`, w, 200);
  check(`B ${who}: sees only published shifts and no checks`, w.body.shifts.every((s) => s.isPublished) && w.body.issues.length === 0 && !w.body.canEdit);
  const dir = (await c.get('/staff?search=&includeInactive=false')).body;
  check(`B ${who}: directory limited to own location`, dir.length > 0 && dir.every((s) => s.homeLocation === 'Downtown') && dir.every((s) => s.credentialStatus === null));
  expectStatus(`B ${who}: other person's profile 403`, await c.get(`/staff/${sid('Ethan')}`), 403);
  expectStatus(`B ${who}: own profile 200`, await c.get(`/staff/${c.me.staffId}`), 200);
}
expectStatus('B reception: cannot create a shift', await reception.post('/schedule/shifts', { locationId: loc.Downtown, staffId: sid('Hannah'), shiftDate: '2030-01-07', startTime: '08:00', endTime: '12:00' }), 403);

expectStatus('B manager: dashboard 200', await manager.get('/dashboard'), 200);
expectStatus('B manager: other location dashboard 403', await manager.get(`/dashboard?locationId=${loc.Riverside}`), 403);
expectStatus('B manager: audit 403', await manager.get('/audit?entity=&page=0'), 403);
expectStatus('B manager: billing 403', await manager.get('/clinic/billing'), 403);
expectStatus('B manager: settings update 403', await manager.put('/clinic/settings', { name: 'x', timeZoneId: 'America/New_York', workweekStart: 'Monday', overtimeThresholdHours: 40, defaultBreakMinutes: 30, leaveAllowanceDays: 15 }), 403);
expectStatus('B manager: coverage save 403', await manager.put('/clinic/coverage', { locationId: loc.Downtown, cells: [] }), 403);
expectStatus('B manager: other location attendance 403', await manager.get(`/attendance?locationId=${loc.Riverside}`), 403);
expectStatus('B manager: edit the owner 403', await manager.put(`/staff/${sid('Maya')}`, validStaff('Maya')), 403);
expectStatus('B manager: edit other location staff 403', await manager.put(`/staff/${sid('Lucas')}`, { ...validStaff('Lucas'), homeLocationId: loc.Riverside }), 403);
expectStatus('B manager: invite 403 (owner only)', await manager.post(`/staff/${sid('Chloe')}/invite`), 403);
const mgrDir = (await manager.get('/staff?search=&includeInactive=false')).body;
check('B manager: directory spans both locations', mgrDir.some((s) => s.homeLocation === 'Riverside'));
check('B manager: credential status only for own location', mgrDir.filter((s) => s.homeLocation === 'Riverside').every((s) => s.credentialStatus === null)
  && mgrDir.filter((s) => s.homeLocation === 'Downtown').some((s) => s.credentialStatus !== null));
const rivWeek = await manager.get(`/schedule?locationId=${loc.Riverside}`);
check('B manager: can view but not edit the other location', rivWeek.status === 200 && rivWeek.body.canEdit === false && rivWeek.body.shifts.every((s) => s.isPublished));

// ---------- C. Schedule ----------
const thisWeek = (await manager.get('/schedule')).body;
const nextStart = addDays(thisWeek.weekStart, 7);
const nextDown = (await manager.get(`/schedule?locationId=${loc.Downtown}&date=${nextStart}`)).body;
check('C1 next week Downtown has drafts', nextDown.draftCount > 0, `drafts=${nextDown.draftCount}`);
const mon = nextStart, wed = addDays(nextStart, 2);
const base = { locationId: loc.Downtown, staffId: sid('Lucas'), shiftDate: mon, startTime: '13:00', endTime: '17:00', unpaidBreakMinutes: 0 };
let r = await manager.post('/schedule/shifts', { ...base, endTime: '12:00' });
expectStatus('C2 end before start is 400', r, 400);
check('C3 error is on endTime', !!r.body?.errors?.endTime);
expectStatus('C4 break longer than shift is 400', await manager.post('/schedule/shifts', { ...base, unpaidBreakMinutes: 300 }), 400);
r = await manager.post('/schedule/shifts', base);
expectStatus('C5 manager schedules a Riverside dentist at Downtown (cross-location)', r, 200);
const lucasShift = r.body.shifts.find((s) => s.staffId === sid('Lucas') && s.locationId === loc.Downtown && s.shiftDate === mon);
check('C6 overlap with his Riverside shift is warned', r.body.issues.some((i) => i.kind === 'Overlap' && i.shiftId === lucasShift?.shiftId));
check('C7 his expired licence blocks', r.body.issues.some((i) => i.kind === 'ExpiredLicence' && i.severity === 'Block' && i.shiftId === lucasShift?.shiftId));
expectStatus('C8 second shift same person/day/location is 400', await manager.post('/schedule/shifts', base), 400);
expectStatus('C9 manager cannot schedule at the other location', await manager.post('/schedule/shifts', { ...base, locationId: loc.Riverside, staffId: sid('Grace') }), 403);
r = await manager.put(`/schedule/shifts/${lucasShift.shiftId}`, { ...base, startTime: '18:00', endTime: '20:00' });
expectStatus('C10 update shift', r, 200);
check('C11 overlap gone after moving the time', !r.body.issues.some((i) => i.kind === 'Overlap' && i.shiftId === lucasShift.shiftId));
r = await manager.del(`/schedule/shifts/${lucasShift.shiftId}`);
expectStatus('C12 delete shift', r, 200);
check('C13 deleted shift is gone', !r.body.shifts.some((s) => s.shiftId === lucasShift.shiftId));
expectStatus('C14 deleting again is 404', await manager.del(`/schedule/shifts/${lucasShift.shiftId}`), 404);

// Approved leave (Chloe, Wed-Thu next week) means no draft was created, and a manual shift warns.
check('C15 fill skipped Chloe on approved leave', !nextDown.shifts.some((s) => s.staffId === sid('Chloe') && s.shiftDate === wed));
r = await manager.post('/schedule/shifts', { ...base, staffId: sid('Chloe'), shiftDate: wed, startTime: '08:00', endTime: '12:00' });
check('C16 shift on approved leave warns', r.body.issues.some((i) => i.kind === 'OnLeave'));
const chloeShift = r.body.shifts.find((s) => s.staffId === sid('Chloe') && s.shiftDate === wed);
await manager.del(`/schedule/shifts/${chloeShift.shiftId}`);

// Minimum staffing: remove Downtown dentists on Monday next week.
const monDentists = nextDown.shifts.filter((s) => s.shiftDate === mon && [sid('Ethan'), sid('Priya')].includes(s.staffId));
let wk;
for (const s of monDentists) wk = (await manager.del(`/schedule/shifts/${s.shiftId}`)).body;
check('C17 below-minimum warning when no dentist on Monday', wk?.issues.some((i) => i.kind === 'BelowMinimum' && i.date === mon && i.message.includes('Dentist')));
r = await manager.post('/schedule/fill', { locationId: loc.Downtown, weekStart: nextStart });
expectStatus('C18 fill from patterns', r, 200);
check('C19 fill restores the deleted dentist shifts', r.body.created === monDentists.length, `created ${r.body.created}`);
check('C20 Ava overtime warning exists at Riverside', (await owner.get(`/schedule?locationId=${loc.Riverside}&date=${nextStart}`)).body.issues.some((i) => i.kind === 'Overtime'));

const notifBefore = (await hygienist.get('/notifications')).body.unread;
r = await manager.post('/schedule/publish', { locationId: loc.Downtown, weekStart: nextStart });
expectStatus('C21 publish Downtown next week', r, 200);
check('C22 all drafts published', r.body.week.draftCount === 0 && r.body.published > 0);
check('C23 staff notified on publish', (await hygienist.get('/notifications')).body.unread > notifBefore);
expectStatus('C24 manager cannot publish Riverside', await manager.post('/schedule/publish', { locationId: loc.Riverside, weekStart: nextStart }), 403);
r = await owner.post('/schedule/publish', { locationId: loc.Riverside, weekStart: nextStart });
expectStatus('C25 owner publish with licence block needs a reason', r, 400);
check('C26 reason error is on overrideReason', !!r.body?.errors?.overrideReason);
r = await owner.post('/schedule/publish', { locationId: loc.Riverside, weekStart: nextStart, overrideReason: 'Renewal confirmed by phone; certificate pending' });
expectStatus('C27 owner override publishes', r, 200);
check('C28 overrides recorded and blocks cleared', r.body.overrides > 0 && !r.body.week.issues.some((i) => i.severity === 'Block'));
expectStatus('C29 publish unknown location 404', await owner.post('/schedule/publish', { locationId: 99999, weekStart: nextStart }), 404);
const mine = await hygienist.get('/schedule/mine');
check('C30 my upcoming shifts are published and mine', mine.status === 200 && mine.body.length > 0 && mine.body.every((s) => s.staffId === hygienist.me.staffId && s.isPublished));

// ---------- D. Leave ----------
const sat = addDays(nextStart, 12); // a Saturday two weeks out
r = await hygienist.post('/leave', { startDate: sat, endDate: addDays(sat, 1), firstDayHalf: false, lastDayHalf: false, leaveType: 'annual', note: null });
expectStatus('D1 weekend-only leave for a Mon-Fri worker is 400', r, 400);
check('D2 says no working days', JSON.stringify(r.body).includes('None of these dates'));
expectStatus('D3 both halves on a single day is 400', await hygienist.post('/leave/preview', { startDate: addDays(nextStart, 14), endDate: addDays(nextStart, 14), firstDayHalf: true, lastDayHalf: true, leaveType: 'annual', note: null }), 400);
expectStatus('D4 end before start is 400', await hygienist.post('/leave/preview', { startDate: addDays(nextStart, 15), endDate: addDays(nextStart, 14), firstDayHalf: false, lastDayHalf: false, leaveType: 'annual', note: null }), 400);
const leaveMon = addDays(nextStart, 14);
r = await hygienist.post('/leave/preview', { startDate: leaveMon, endDate: addDays(leaveMon, 4), firstDayHalf: true, lastDayHalf: false, leaveType: 'annual', note: null });
check('D5 preview counts 4.5 days for Mon(half)-Fri', r.body?.daysCounted === 4.5, JSON.stringify(r.body));
const balBefore = (await hygienist.get('/leave/mine')).body.balance;
const mgrNotif = (await manager.get('/notifications')).body.unread;
r = await hygienist.post('/leave', { startDate: leaveMon, endDate: addDays(leaveMon, 4), firstDayHalf: true, lastDayHalf: false, leaveType: 'annual', note: 'Conference' });
expectStatus('D6 request leave', r, 200);
const req = r.body.requests.find((x) => x.startDate === leaveMon);
check('D7 request is pending with 4.5 days', req?.status === 'pending' && req?.daysCounted === 4.5);
check('D8 pending shows in balance', r.body.balance.pending === balBefore.pending + 4.5);
check('D9 manager notified', (await manager.get('/notifications')).body.unread > mgrNotif);
expectStatus('D10 overlapping request is 400', await hygienist.post('/leave', { startDate: addDays(leaveMon, 2), endDate: addDays(leaveMon, 2), firstDayHalf: false, lastDayHalf: false, leaveType: 'sick', note: null }), 400);
const inbox = (await manager.get('/leave/inbox')).body;
const item = inbox.find((i) => i.request.leaveRequestId === req.leaveRequestId);
check('D11 request in manager inbox with impact list', !!item && Array.isArray(item.impact));
expectStatus('D12 hygienist cannot decide', await hygienist.post(`/leave/${req.leaveRequestId}/decide`, { approve: true }), 403);
r = await manager.post(`/leave/${req.leaveRequestId}/decide`, { approve: true, comment: 'Have a good conference' });
expectStatus('D13 manager approves', r, 200);
expectStatus('D14 deciding twice is 409', await manager.post(`/leave/${req.leaveRequestId}/decide`, { approve: false, comment: 'Sorry' }), 409);
const after = (await hygienist.get('/leave/mine')).body;
check('D15 approved leave reduces balance', after.balance.used === balBefore.used + 4.5 && after.requests.find((x) => x.leaveRequestId === req.leaveRequestId)?.decidedBy === 'Jordan Lee');
const mgrLeave = await manager.post('/leave', { startDate: addDays(leaveMon, 7), endDate: addDays(leaveMon, 7), firstDayHalf: false, lastDayHalf: false, leaveType: 'annual', note: null });
const mgrReq = mgrLeave.body.requests.find((x) => x.startDate === addDays(leaveMon, 7));
check('D16 manager request is pending', mgrReq?.status === 'pending');
check('D17 manager does not see own request in inbox', !(await manager.get('/leave/inbox')).body.some((i) => i.request.leaveRequestId === mgrReq.leaveRequestId));
check('D18 owner sees manager request', (await owner.get('/leave/inbox')).body.some((i) => i.request.leaveRequestId === mgrReq.leaveRequestId));
expectStatus('D19 manager cannot decide own leave', await manager.post(`/leave/${mgrReq.leaveRequestId}/decide`, { approve: true }), 403);
// The owner has no work pattern, so give them a published shift first (leave counts published shifts), then their own leave is recorded as approved.
await owner.post('/schedule/shifts', { locationId: loc.Downtown, staffId: owner.me.staffId, shiftDate: addDays(leaveMon, 21), startTime: '09:00', endTime: '12:00', unpaidBreakMinutes: 0, isPublished: true });
r = await owner.post('/leave', { startDate: addDays(leaveMon, 21), endDate: addDays(leaveMon, 21), firstDayHalf: false, lastDayHalf: false, leaveType: 'other', note: null });
check('D20 sole owner leave auto-approved', r.status === 200 && r.body.requests[0]?.status === 'approved', JSON.stringify(r.body).slice(0, 200));
// Withdrawing, and rejecting with a reason.
r = await reception.post('/leave', { startDate: addDays(leaveMon, 28), endDate: addDays(leaveMon, 28), firstDayHalf: false, lastDayHalf: false, leaveType: 'sick', note: null });
const recReq = r.body?.requests?.find((x) => x.startDate === addDays(leaveMon, 28));
check('D22 reception request is pending', recReq?.status === 'pending', JSON.stringify(r.body).slice(0, 200));
r = await hygienist.del(`/leave/${recReq.leaveRequestId}`);
expectStatus('D23 cannot withdraw someone else\'s request', r, 404);
r = await reception.del(`/leave/${recReq.leaveRequestId}`);
check('D24 own pending request withdrawn', r.status === 200 && !r.body.requests.some((x) => x.leaveRequestId === recReq.leaveRequestId));
expectStatus('D25 cannot withdraw a decided request', await hygienist.del(`/leave/${req.leaveRequestId}`), 409);
r = await reception.post('/leave', { startDate: addDays(leaveMon, 29), endDate: addDays(leaveMon, 29), firstDayHalf: false, lastDayHalf: false, leaveType: 'sick', note: null });
const recReq2 = r.body.requests.find((x) => x.startDate === addDays(leaveMon, 29));
r = await manager.post(`/leave/${recReq2.leaveRequestId}/decide`, { approve: false, comment: '' });
check('D26 rejecting needs a reason', r.status === 400 && !!r.body?.errors?.comment);
expectStatus('D27 reject with a reason', await manager.post(`/leave/${recReq2.leaveRequestId}/decide`, { approve: false, comment: 'Two others are off that day' }), 200);
const bal = (await hygienist.get('/leave/mine')).body.balance;
r = await hygienist.post('/leave', { startDate: addDays(leaveMon, 35), endDate: addDays(leaveMon, 35 + 55), firstDayHalf: false, lastDayHalf: false, leaveType: 'annual', note: null });
check('D28 annual leave beyond the allowance is refused', r.status === 400 && JSON.stringify(r.body).includes('left for'), `balance ${JSON.stringify(bal)} -> ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
expectStatus('D29 team leave range over 120 days is 400', await reception.get(`/leave/team?from=2026-01-01&to=2026-12-31`), 400);
const team = (await reception.get(`/leave/team?from=${leaveMon}&to=${addDays(leaveMon, 4)}`)).body;
check('D21 reception sees team leave dates only', team.some((t) => t.staffName === 'Grace Kim') && team.every((t) => t.leaveType === 'leave' && t.note === null));

// ---------- E. Attendance ----------
r = await hygienist.get('/attendance/me');
check('E1 clock status loads with locations', r.status === 200 && r.body.locations.length === 2);
r = await hygienist.post('/attendance/clock-in', { locationId: loc.Downtown });
expectStatus('E2 clock in', r, 200);
check('E3 open record uses the database clock', !!r.body.open && Math.abs(new Date(r.body.open.clockInUtc) - new Date(r.body.serverUtc)) < 120000);
expectStatus('E4 clocking in twice is 409', await hygienist.post('/attendance/clock-in', { locationId: loc.Downtown }), 409);
r = await hygienist.post('/attendance/clock-out');
expectStatus('E5 clock out', r, 200);
check('E6 no open record after clock-out', r.body.open === null);
expectStatus('E7 clocking out twice is 409', await hygienist.post('/attendance/clock-out'), 409);
expectStatus('E8 unknown location is 400', await hygienist.post('/attendance/clock-in', { locationId: 99999 }), 400);
const ownerNotif = (await manager.get('/notifications')).body.unread;
r = await owner.post('/attendance/clock-in', { locationId: loc.Downtown });
check('E9 owner without a shift today is flagged unscheduled', r.status === 200 && r.body.open?.isUnscheduled === true);
check('E10 Downtown manager notified of unscheduled clock-in', (await manager.get('/notifications')).body.unread > ownerNotif);
await owner.post('/attendance/clock-out');
const att = (await manager.get(`/attendance?locationId=${loc.Downtown}`)).body;
const missing = att.find((a) => a.missingClockOut);
const unsched = att.find((a) => a.isUnscheduled && !a.unscheduledConfirmed && a.staffName === 'Marcus Allen');
const own = att.find((a) => a.staffId === manager.me.staffId);
check('E11 seeded missed clock-out is flagged', !!missing);
check('E12 seeded unscheduled clock-in is flagged', !!unsched);
const [inDate] = missing.clockInUtc.split('T');
r = await manager.put(`/attendance/${missing.attendanceId}`, { clockInDate: inDate, clockInTime: '07:56', clockOutDate: inDate, clockOutTime: '16:40', unpaidBreakMinutes: 30, note: '' });
expectStatus('E13 correction without a note is 400', r, 400);
check('E14 error is on note', !!r.body?.errors?.note);
expectStatus('E15 clock-out before clock-in is 400', await manager.put(`/attendance/${missing.attendanceId}`, { clockInDate: inDate, clockInTime: '07:56', clockOutDate: inDate, clockOutTime: '06:00', unpaidBreakMinutes: 30, note: 'x' }), 400);
r = await manager.put(`/attendance/${missing.attendanceId}`, { clockInDate: inDate, clockInTime: '07:56', clockOutDate: inDate, clockOutTime: '16:40', unpaidBreakMinutes: 0, note: 'Forgot to clock out; worked through lunch' });
expectStatus('E16 correction saved', r, 200);
check('E17 corrected record is no longer missing and break is 0', r.body.missingClockOut === false && r.body.unpaidBreakMinutes === 0 && r.body.correctionNote?.startsWith('Forgot'));
r = await manager.post(`/attendance/${unsched.attendanceId}/confirm`);
check('E18 confirm unscheduled', r.status === 200 && r.body.unscheduledConfirmed === true);
expectStatus('E19 confirming a scheduled record is 409', await manager.post(`/attendance/${missing.attendanceId}/confirm`), 409);
r = await manager.put(`/attendance/${missing.attendanceId}`, { clockInDate: '2026-03-08', clockInTime: '02:30', clockOutDate: '2026-03-08', clockOutTime: '09:00', unpaidBreakMinutes: 0, note: 'DST probe' });
check('E21 a time skipped by the daylight-saving change is a field error', r.status === 400 && !!r.body?.errors?.clockInTime, JSON.stringify(r.body).slice(0, 200));
r = await manager.put(`/attendance/${missing.attendanceId}`, { clockInDate: inDate, clockInTime: '07:56', clockOutDate: null, clockOutTime: null, unpaidBreakMinutes: 0, note: 'Reopen' });
check('E22 a past day cannot be left without a clock-out', r.status === 400 && !!r.body?.errors?.clockOutTime, JSON.stringify(r.body).slice(0, 200));
const ownerRec = att.find((a) => a.staffId === owner.me.staffId);
if (ownerRec) expectStatus('E23 manager cannot correct the owner\'s attendance', await manager.put(`/attendance/${ownerRec.attendanceId}`, { clockInDate: ownerRec.clockInUtc.split('T')[0], clockInTime: '08:00', clockOutDate: ownerRec.clockInUtc.split('T')[0], clockOutTime: '09:00', unpaidBreakMinutes: 0, note: 'x' }), 403);
if (own) expectStatus('E20 manager cannot correct own record', await manager.put(`/attendance/${own.attendanceId}`, { clockInDate: inDate, clockInTime: '08:00', clockOutDate: inDate, clockOutTime: '16:00', unpaidBreakMinutes: 30, note: 'x' }), 403);
else check('E20 manager has a seeded own record', false);

// ---------- F. Staff ----------
const newStaff = {
  firstName: 'Test', lastName: 'Assistant', email: 'test.assistant@brightsmiles.test', phone: null, jobTitleId: titles['Dental assistant'],
  homeLocationId: loc.Downtown, startDate: thisWeek.weekStart, overtimeEligible: true, employmentType: 'part_time',
  pattern: [{ weekday: 'Monday', shiftDefinitionId: defs['Morning'].id, locationId: loc.Downtown }, { weekday: 'Wednesday', shiftDefinitionId: defs['Morning'].id, locationId: loc.Downtown }],
};
r = await manager.post('/staff', { ...newStaff, email: 'not-an-email' });
expectStatus('F1 invalid email is 400', r, 400);
check('F2 error on email', !!r.body?.errors?.email);
expectStatus('F3 manager cannot create a practice manager', await manager.post('/staff', { ...newStaff, jobTitleId: titles['Practice manager'] }), 400);
expectStatus('F4 manager cannot add staff at the other location', await manager.post('/staff', { ...newStaff, homeLocationId: loc.Riverside }), 400);
expectStatus('F5 duplicate email is 400', await manager.post('/staff', { ...newStaff, email: hygienist.me.email }), 400);
r = await manager.post('/staff', newStaff);
expectStatus('F6 manager adds staff', r, 200);
const created = r.body;
check('F7 role comes from job title; pattern saved', created.role === 'clinical_staff' && created.pattern.length === 2 && created.canEdit && !created.canInvite);
r = await manager.put(`/staff/${created.staffId}`, { ...newStaff, pattern: [...newStaff.pattern, { weekday: 'Friday', shiftDefinitionId: defs['Morning'].id, locationId: loc.Downtown }] });
check('F8 pattern update', r.status === 200 && r.body.pattern.length === 3);
r = await manager.post(`/staff/${created.staffId}/credentials`, { credentialTypeId: lookups.credentialTypes.find((t) => t.name.startsWith('CPR')).id, expiresOn: addDays(thisWeek.weekStart, 10) });
check('F9 add credential, shows expiring', r.status === 200 && r.body.credentials[0]?.status === 'expiring');
r = await manager.del(`/staff/${created.staffId}/credentials/${r.body.credentials[0].credentialId}`);
check('F10 remove credential', r.status === 200 && r.body.credentials.length === 0);
expectStatus('F11 invitations are off in the demo clinic', await owner.post(`/staff/${created.staffId}/invite`), 409);
expectStatus('F12 demo sign-in people cannot be deactivated', await owner.post(`/staff/${hygienist.me.staffId}/deactivate`), 409);
expectStatus('F13 a manager cannot change their own credentials', await manager.post(`/staff/${manager.me.staffId}/credentials`, { credentialTypeId: lookups.credentialTypes[0].id, expiresOn: '2030-01-01' }), 403);
expectStatus('F14 a manager cannot change the owner\'s credentials', await manager.post(`/staff/${sid('Maya')}/credentials`, { credentialTypeId: lookups.credentialTypes[0].id, expiresOn: '2030-01-01' }), 403);
r = await manager.put(`/staff/${hygienist.me.staffId}`, { firstName: 'Grace', lastName: 'Kim', email: 'grace.new@brightsmiles.test', phone: null, jobTitleId: titles['Hygienist'], homeLocationId: loc.Downtown, startDate: '2024-01-01', overtimeEligible: true, employmentType: 'full_time', pattern: [] });
check('F15 the sign-in email of an account cannot be changed', r.status === 400 && !!r.body?.errors?.email, JSON.stringify(r.body).slice(0, 200));
expectStatus('F16 control characters in names are refused', await manager.post('/staff', { ...newStaff, email: 'rtl@brightsmiles.test', firstName: 'Evil\u202Ename' }), 400);
expectStatus('F16b a display-name email is refused', await manager.post('/staff', { ...newStaff, email: 'Test <t2@brightsmiles.test>' }), 400);
r = await manager.post(`/staff/${created.staffId}/deactivate`);
check('F17 deactivate keeps the record', r.status === 200 && r.body.isActive === false);
check('F20 hidden from default directory', !(await manager.get('/staff?search=Test&includeInactive=false')).body.some((s) => s.staffId === created.staffId));
check('F21 visible with "show deactivated"', (await manager.get('/staff?search=Test&includeInactive=true')).body.some((s) => s.staffId === created.staffId));
expectStatus('F22 reactivate', await manager.post(`/staff/${created.staffId}/reactivate`), 200);
expectStatus('F23 manager cannot deactivate self', await manager.post(`/staff/${manager.me.staffId}/deactivate`), 403);
check('F24 search finds by name', (await manager.get('/staff?search=Grace&includeInactive=false')).body.length === 1);

// ---------- G. Clinic settings ----------
const settings = (await owner.get('/clinic/settings')).body;
r = await owner.put('/clinic/settings', { ...settings, overtimeThresholdHours: 0, defaultBreakMinutes: 500, timeZoneId: 'Mars/Base' });
expectStatus('G1 invalid settings 400', r, 400);
check('G2 errors per field', ['overtimeThresholdHours', 'defaultBreakMinutes', 'timeZoneId'].every((f) => r.body?.errors?.[f]));
r = await owner.put('/clinic/settings', { ...settings, overtimeThresholdHours: 38 });
check('G3 valid settings saved', r.status === 200 && r.body.overtimeThresholdHours === 38);
await owner.put('/clinic/settings', settings);
const cov = (await owner.get(`/clinic/coverage/${loc.Downtown}`)).body;
r = await owner.put('/clinic/coverage', { locationId: loc.Downtown, cells: [...cov.cells, { jobTitleId: titles['Dental assistant'], weekday: 'Monday', minHeadcount: 2 }] });
check('G4 coverage saved', r.status === 200 && r.body.cells.some((c) => c.jobTitleId === titles['Dental assistant'] && c.minHeadcount === 2));
expectStatus('G5 coverage out of range 400', await owner.put('/clinic/coverage', { locationId: loc.Downtown, cells: [{ jobTitleId: titles['Dentist'], weekday: 'Monday', minHeadcount: 99 }] }), 400);
expectStatus('G6 closed day in the past 400', await owner.post('/clinic/closed-days', { closedOn: '2020-01-01', name: 'Old', locationId: null }), 400);
r = await owner.post('/clinic/closed-days', { closedOn: addDays(nextStart, 30), name: 'Staff training day', locationId: loc.Downtown });
const cd = r.body.find((c) => c.name === 'Staff training day');
check('G7 closed day added', r.status === 200 && !!cd);
r = await owner.del(`/clinic/closed-days/${cd.closedDayId}`);
check('G8 closed day removed', r.status === 200 && !r.body.some((c) => c.closedDayId === cd.closedDayId));
expectStatus('G9 the demo clinic plan cannot be changed', await owner.post('/clinic/billing/plan', { planCode: 'starter' }), 409);
expectStatus('G10 locations cannot be added to the demo clinic', await owner.post('/clinic/locations', { name: 'Hillcrest', address: null }), 400);
const billing = (await owner.get('/clinic/billing')).body;
check('G13 billing is simulated and counts seats', billing.simulated === true && billing.activeStaff >= 17 && billing.monthlyEstimate === billing.activeStaff * 6);
r = await owner.get('/clinic/export');
check('G14 export downloads JSON without secrets', r.status === 200 && r.headers.get('content-disposition')?.includes('attachment')
  && !JSON.stringify(r.body).toLowerCase().includes('passwordhash') && !JSON.stringify(r.body).toLowerCase().includes('tokenhash') && r.body.staff.length >= 17);

// ---------- H. Notifications and audit ----------
r = await hygienist.get('/notifications');
check('H1 notifications list', r.status === 200 && r.body.items.length > 0);
r = await hygienist.post('/notifications/read');
check('H2 mark all read', r.status === 200 && r.body.unread === 0);
const audit = (await owner.get('/audit?entity=&page=0')).body;
const entities = new Set(audit.map((a) => a.entityName));
check('H3 audit captures shifts, leave, attendance, staff', ['Shift', 'LeaveRequest', 'AttendanceRecord', 'Staff'].every((e) => entities.has(e)) || (await owner.get('/audit?entity=AttendanceRecord&page=0')).body.length > 0);
const overridesAudit = (await owner.get('/audit?entity=ScheduleOverride&page=0')).body;
check('H4 override audited with the owner', overridesAudit.length > 0 && overridesAudit[0].who === owner.me.email);
const corr = (await owner.get('/audit?entity=AttendanceRecord&page=0')).body;
check('H5 attendance correction audited with before and after', corr.some((a) => a.action === 'update' && a.oldValue?.includes('"ClockOutUtc"') === false && a.newValue?.includes('Forgot')));

// ---------- I. Tenant isolation ----------
const other = new Client();
r = await other.post('/auth/signup', { clinicName: 'Isolation Test Dental', firstName: 'Iso', lastName: 'Owner', email: `iso${Date.now()}@test.test`, password: 'long enough password', timeZoneId: 'America/Chicago', locationNames: ['Main'] });
expectStatus('I1 second clinic signs up', r, 200);
const otherDir = (await other.get('/staff?search=&includeInactive=true')).body;
check('I2 new clinic sees only its owner', otherDir.length === 1);
expectStatus('I3 cannot read demo staff', await other.get(`/staff/${sid('Grace')}`), 404);
expectStatus('I4 cannot edit demo shift', await other.put(`/schedule/shifts/${thisWeek.shifts[0].shiftId}`, { locationId: (await other.get('/clinic/lookups')).body.locations[0].id, staffId: other.me?.staffId ?? 0, shiftDate: '2030-01-07', startTime: '08:00', endTime: '12:00' }), 404);
expectStatus('I5 cannot decide demo leave', await other.post(`/leave/${req.leaveRequestId}/decide`, { approve: false, comment: 'x' }), 404);
expectStatus('I6 cannot view demo location schedule', await other.get(`/schedule?locationId=${loc.Downtown}`), 404);
check('I7 audit shows no demo rows', (await other.get('/audit?entity=&page=0')).body.every((a) => !JSON.stringify(a).includes('Bright Smiles')));
expectStatus('I8 duplicate signup email 400', await new Client().post('/auth/signup', { clinicName: 'X', firstName: 'A', lastName: 'B', email: owner.me.email, password: 'long enough password', timeZoneId: 'America/Chicago', locationNames: ['Main'] }), 400);

// ---------- L. Invitations, passwords and sessions (in the fresh clinic, since the demo has invites off) ----------
const otherLoc = (await other.get('/clinic/lookups')).body;
const otherTitle = otherLoc.jobTitles.find((j) => j.role === 'clinical_staff').id;
const stamp = Date.now();
const person = (first, email) => ({ firstName: first, lastName: 'Invitee', email, phone: null, jobTitleId: otherTitle, homeLocationId: otherLoc.locations[0].id, startDate: '2026-01-05', overtimeEligible: true, employmentType: 'full_time', pattern: [] });
const invEmail = `ivy${stamp}@test.test`;
const ivy = (await other.post('/staff', person('Ivy', invEmail))).body;
r = await other.post(`/staff/${ivy.staffId}/invite`);
expectStatus('L1 owner invites', r, 200);
const oldToken = r.body.acceptUrlPath.split('/').pop();
r = await other.post(`/staff/${ivy.staffId}/invite`);
const token = r.body.acceptUrlPath.split('/').pop();
expectStatus('L2 a newer invitation replaces the older link', await new Client().post('/auth/invite', { token: oldToken, password: 'blue chair at noon' }), 404);
const invitee = new Client();
expectStatus('L3 short password is 400', await invitee.post('/auth/invite', { token, password: 'short' }), 400);
expectStatus('L4 a well-known password is 400', await invitee.post('/auth/invite', { token, password: 'password123' }), 400);
expectStatus('L5 bad token is 404', await invitee.post('/auth/invite', { token: 'nope', password: 'blue chair at noon' }), 404);
r = await invitee.post('/auth/invite', { token, password: 'blue chair at noon' });
check('L6 invite accepted and signed in', r.status === 200 && r.body.email === invEmail);
expectStatus('L7 token cannot be reused', await new Client().post('/auth/invite', { token, password: 'blue chair at noon' }), 404);
expectStatus('L8 a person with an account cannot be invited again', await other.post(`/staff/${ivy.staffId}/invite`), 409);
// Changing the address after the link was sent makes the link unusable: it cannot be used to take over the profile.
const jay = (await other.post('/staff', person('Jay', `jay${stamp}@test.test`))).body;
const jayToken = (await other.post(`/staff/${jay.staffId}/invite`)).body.acceptUrlPath.split('/').pop();
await other.put(`/staff/${jay.staffId}`, person('Jay', `jay.new${stamp}@test.test`));
expectStatus('L9 a link sent to an old address no longer works', await new Client().post('/auth/invite', { token: jayToken, password: 'blue chair at noon' }), 404);
// Sign-out ends a copied session too.
const deviceA = new Client();
expectStatus('L10 new user can sign in with the password', await deviceA.post('/auth/login', { email: invEmail, password: 'blue chair at noon' }), 200);
const deviceB = new Client();
deviceB.cookie = deviceA.cookie;
expectStatus('L11 the copied session works before sign-out', await deviceB.get('/auth/me'), 200);
await deviceA.post('/auth/logout');
expectStatus('L12 signing out ends every copy of the session', await deviceB.get('/auth/me'), 401);
const relogin = new Client();
await relogin.post('/auth/login', { email: invEmail, password: 'blue chair at noon' });
r = await other.post(`/staff/${ivy.staffId}/deactivate`);
check('L13 deactivate keeps the record', r.status === 200 && r.body.isActive === false);
expectStatus('L14 deactivated session is rejected at once', await relogin.get('/auth/me'), 401);
expectStatus('L15 deactivated user cannot sign in', await new Client().post('/auth/login', { email: invEmail, password: 'blue chair at noon' }), 400);
r = await new Client().post('/auth/signup', { clinicName: 'Weak', firstName: 'A', lastName: 'B', email: `weak${stamp}@test.test`, password: `weak${stamp}@test.test`, timeZoneId: 'America/Chicago', locationNames: ['Main'] });
check('L16 the email as a password is refused at sign-up', r.status === 400 && !!r.body?.errors?.password);
// Plans and locations (in the fresh clinic: the demo's are fixed).
r = await other.post('/clinic/locations', { name: 'Second', address: null });
check('L17 second location added', r.status === 200 && r.body.locations.length === 2);
expectStatus('L18 duplicate location name 400 (any case)', await other.post('/clinic/locations', { name: 'second' }), 400);
expectStatus('L19 starter refused with 2 locations', await other.post('/clinic/billing/plan', { planCode: 'starter' }), 400);
await other.post('/clinic/locations', { name: 'Third' });
expectStatus('L20 fourth location blocked by plan', await other.post('/clinic/locations', { name: 'Fourth' }), 400);
r = await other.post('/clinic/billing/plan', { planCode: 'practice' });
check('L21 plan change is simulated', r.status === 200 && r.body.planCode === 'practice' && r.body.simulated === true);
// Per-account lockout: five wrong passwords lock that account even from different clients.
const lockEmail = `lock${stamp}@test.test`;
await new Client().post('/auth/signup', { clinicName: 'Lock Test', firstName: 'L', lastName: 'T', email: lockEmail, password: 'blue chair at noon', timeZoneId: 'America/Chicago', locationNames: ['Main'] });

// ---------- K. Malformed input gets field errors, never internal type names ----------
r = await manager.post(`/staff/${sid('Grace')}/credentials`, { credentialTypeId: 1, expiresOn: '' });
check('K1 empty date maps to the field', r.status === 400 && r.body?.errors?.expiresOn?.[0] === 'Enter a valid date.', JSON.stringify(r.body));
r = await manager.post('/schedule/shifts', { locationId: loc.Downtown, staffId: sid('Grace'), shiftDate: '2030-01-07', startTime: '', endTime: '12:00' });
check('K2 empty time maps to the field', r.status === 400 && r.body?.errors?.startTime?.[0] === 'Enter a valid time.', JSON.stringify(r.body));
r = await manager.req('POST', '/leave/preview', undefined);
check('K3 empty body gives a plain message', r.status === 400 && !JSON.stringify(r.body).includes('DentalStaff.'), JSON.stringify(r.body));
check('K4 no response leaks .NET type names', !JSON.stringify((await manager.post('/leave/preview', { startDate: 'x' })).body).includes('DentalStaff.'));

// ---------- J. Security headers and rate limit (last: it locks auth for this IP for a minute) ----------
r = await owner.get('/clinic/settings');
check('J1 security headers', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && r.headers.get('cache-control') === 'no-store'
  && r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'") && !!r.headers.get('permissions-policy'));
const lockCodes = [];
for (let i = 0; i < 6; i++) lockCodes.push((await new Client().post('/auth/login', { email: lockEmail, password: 'wrong guess here' })).status);
const afterLock = await new Client().post('/auth/login', { email: lockEmail, password: 'blue chair at noon' });
check('J3 an account locks after five wrong passwords, even with the right one', afterLock.status === 409 || afterLock.status === 429, `${lockCodes.join(',')} then ${afterLock.status}`);
const codes = [];
for (let i = 0; i < 90 && !codes.includes(429); i++) codes.push((await new Client().post('/auth/login', { email: 'x@y.z', password: 'wrong password' })).status);
check('J2 auth rate limit returns 429', codes.includes(429), codes.join(','));

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(failures.length ? 1 : 0);
