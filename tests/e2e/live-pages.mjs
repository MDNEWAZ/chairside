// Opens every page of a published site as each demo role in headless Edge and reports problems:
// error screens, failed requests, console errors, sideways scrolling, and missing headings. Changes no data.
//   node tests/e2e/live-pages.mjs https://your-site [screenshotDir]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = (process.argv[2] ?? '').replace(/\/$/, '');
const SHOTS = process.argv[3];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9371;
const profile = mkdtempSync(join(tmpdir(), 'claude-livepages-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 40 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); let events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') events.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Network.responseReceived') {
    const { url, status } = m.params.response;
    if (url.includes('/api/') && status >= 500) events.push(`HTTP ${status} ${url.replace(SITE, '')}`);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.text)) events.push('log: ' + m.params.entry.text.slice(0, 200));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');

const VIEWPORTS = { desktop: { width: 1280, height: 860, mobile: false }, phone: { width: 360, height: 780, mobile: true } };
const ROUTES = {
  owner: ['/today', '/my', '/schedule', '/leave', '/attendance', '/staff', '/staff/7', '/settings', '/audit'],
  manager: ['/today', '/my', '/schedule', '/leave', '/attendance', '/staff', '/staff/7'],
  hygienist: ['/my', '/schedule', '/leave', '/staff', '/staff/7'],
  reception: ['/my', '/schedule', '/leave', '/staff', '/staff/15'],
};
const problems = []; let pages = 0;

async function open(path) {
  events = [];
  await send('Page.navigate', { url: SITE + path });
  // Wait until the app has rendered a heading or an error state, then let requests settle.
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('main h1, [role=alert] h1, h1')`);
    if (ready) break;
    await sleep(250);
  }
  await sleep(1500);
}

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
  for (const [persona, routes] of Object.entries(ROUTES)) {
    await send('Network.clearBrowserCookies');
    await open('/login');
    const signedIn = await evaluate(`fetch('/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chairside-Csrf': '1' }, body: JSON.stringify({ persona: '${persona}' }) }).then(r => r.status)`);
    if (signedIn !== 200) { problems.push(`${vpName} ${persona}: demo sign-in returned ${signedIn}`); continue; }
    for (const route of routes) {
      await open(route);
      pages++;
      const info = await evaluate(`(() => ({
        path: location.pathname,
        h1: document.querySelector('h1')?.textContent?.trim() ?? '',
        errorScreen: !!document.body.innerText.match(/could not load Chairside|Something went wrong|Cannot reach the server/i),
        errorState: [...document.querySelectorAll('[role=alert]')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 2),
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      }))()`);
      const tag = `${vpName} ${persona} ${route}`;
      if (info.path !== route) problems.push(`${tag}: redirected to ${info.path}`);
      if (!info.h1) problems.push(`${tag}: no heading rendered`);
      if (info.errorScreen) problems.push(`${tag}: error screen shown`);
      if (info.errorState.length) problems.push(`${tag}: alert "${info.errorState.join(' | ').slice(0, 160)}"`);
      if (info.sideways) problems.push(`${tag}: sideways scroll`);
      for (const e of events) problems.push(`${tag}: ${e}`);
      if (SHOTS) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(SHOTS, `${vpName}-${persona}-${route.replace(/\//g, '_') || 'root'}.png`), Buffer.from(shot.data, 'base64'));
      }
      process.stdout.write(`${info.errorScreen || !info.h1 ? 'x' : '.'}`);
    }
  }
}

console.log(`\n${SITE}: ${pages} page views, ${problems.length} problem(s)`);
for (const p of problems) console.log('  ' + p);
ws.close(); edge.kill();
process.exit(problems.length ? 1 : 0);
