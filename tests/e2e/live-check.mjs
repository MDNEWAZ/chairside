// Read-only health check for a published site (safe to run against production: it changes no data).
//   node tests/e2e/live-check.mjs https://your-site.vercel.app
const SITE = (process.argv[2] ?? '').replace(/\/$/, '');
if (!SITE) { console.error('Usage: node tests/e2e/live-check.mjs https://your-site'); process.exit(2); }

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => (ok ? passed++ : failures.push(name + (detail ? ' — ' + detail : '')));
const timed = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };

async function req(method, path, { body, cookie, csrf = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-Chairside-Csrf'] = '1';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(SITE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
  const set = (res.headers.getSetCookie?.() ?? []).find((c) => /^(__Host-)?chairside\.auth=/.test(c));
  return { status: res.status, json, text, headers: res.headers, cookie: set?.split(';')[0], setCookie: set };
}

// Front end
const [home, homeMs] = await timed(() => req('GET', '/'));
check('site answers 200 with the app shell', home.status === 200 && home.text.includes('<app-root'), `${home.status}`);
check('site has a Content-Security-Policy', !!home.headers.get('content-security-policy'));
check('deep link serves the app (SPA fallback)', (await req('GET', '/schedule')).text.includes('<app-root'));
const https = SITE.startsWith('https://');
check('served over HTTPS', https);

// API through the same origin
const [health, healthMs] = await timed(() => req('GET', '/api/health'));
check('API health is 200 (API and database reachable)', health.status === 200, `${health.status} ${health.text.slice(0, 120)}`);
const config = await req('GET', '/api/auth/config');
check('public config readable', config.status === 200 && typeof config.json?.minPasswordLength === 'number');
check('signed-out session is 204', (await req('GET', '/api/auth/session')).status === 204);
check('POST without CSRF header is refused', (await req('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x' }, csrf: false })).status === 400);
check('unknown API path is 404 JSON, not the app shell', (await req('GET', '/api/does-not-exist')).status === 404);
const api = await req('GET', '/api/auth/config');
check('API responses are not cached', api.headers.get('cache-control')?.includes('no-store'));

// Demo personas, if the demo is on (sign-in only updates the last-login time)
if (config.json?.demoEnabled) {
  for (const persona of ['owner', 'manager', 'hygienist', 'reception']) {
    const r = await req('POST', '/api/auth/demo', { body: { persona } });
    check(`demo ${persona} signs in`, r.status === 200 && !!r.cookie, `${r.status}`);
    if (!r.cookie) continue;
    check(`demo ${persona} cookie is HttpOnly and SameSite=Strict`, /httponly/i.test(r.setCookie) && /samesite=strict/i.test(r.setCookie));
    if (https) check(`demo ${persona} cookie is Secure`, /secure/i.test(r.setCookie), r.setCookie);
    const s = await req('GET', '/api/auth/session', { cookie: r.cookie });
    check(`demo ${persona} session loads with lookups`, s.status === 200 && s.json?.lookups?.locations?.length >= 1);
    check(`demo ${persona} schedule loads`, (await req('GET', '/api/schedule', { cookie: r.cookie })).status === 200);
    check(`demo ${persona} leave loads`, (await req('GET', '/api/leave/mine', { cookie: r.cookie })).status === 200);
    const dash = await req('GET', '/api/dashboard', { cookie: r.cookie });
    check(`demo ${persona} dashboard permission is right`, dash.status === (persona === 'owner' || persona === 'manager' ? 200 : 403), `${dash.status}`);
  }
}

console.log(`${SITE}\n  page ${homeMs} ms · API health ${healthMs} ms`);
console.log(`  ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(failures.length ? 1 : 0);
