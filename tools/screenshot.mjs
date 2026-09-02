#!/usr/bin/env node
// Headless-Chrome verification tool. See ARCHITECTURE.md §10.
// node tools/screenshot.mjs --showcase=terrain --cam=showcase --time=14 --out=shots/terrain-14
// node tools/screenshot.mjs --all   (standard set)   |  --list prints the standard set
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const URL_BASE = args.url || 'http://localhost:5173';
const W = Number(args.w || 1920), H = Number(args.h || 1080);
const FRAMES = Number(args.frames || 90);
const TIMEOUT = Number(args.timeout || 180000);
const MODULES = ['terrain', 'environment', 'roads', 'zoning', 'buildings', 'props', 'traffic', 'effects', 'simulation', 'tools', 'ui', 'audio', 'demo'];
const TIMES = [9, 14, 19.5, 23];


// ---- concurrency semaphore: at most MAX_PARALLEL screenshot tools render at once (software GL on 4 cores) ----
const MAX_PARALLEL = Number(process.env.SHOT_PARALLEL || 2);
const LOCK_DIR = path.join(process.cwd(), 'shots', '.locks');
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function acquireSlot() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const start = Date.now();
  for (;;) {
    for (let i = 0; i < MAX_PARALLEL; i++) {
      const f = path.join(LOCK_DIR, `slot${i}`);
      try {
        const owner = Number(fs.readFileSync(f, 'utf8'));
        if (!pidAlive(owner) || Date.now() - fs.statSync(f).mtimeMs > 15 * 60 * 1000) fs.unlinkSync(f);
        else continue;
      } catch {}
      try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return () => { try { fs.unlinkSync(f); } catch {} }; } catch {}
    }
    if (Date.now() - start > 30 * 60 * 1000) throw new Error('screenshot slot wait timed out');
    await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1000)));
  }
}

function buildUrl(o) {
  const p = new URLSearchParams();
  if (o.showcase) p.set('showcase', o.showcase);
  if (o.time != null) p.set('time', String(o.time));
  if (o.cam) p.set('cam', o.cam);
  if (o.seed) p.set('seed', String(o.seed));
  if (o.weather) p.set('weather', o.weather);
  if (o.quality) p.set('quality', o.quality);
  if (o.only) p.set('only', o.only);
  if (o.extra) for (const kv of String(o.extra).split('&')) { const [k, v] = kv.split('='); if (k) p.set(k, v ?? ''); }
  p.set('paused', '1');
  return `${URL_BASE}/?${p.toString()}`;
}

async function shoot(browser, o) {
  const out = o.out || `shots/${o.showcase || 'game'}-${o.cam || 'default'}-${o.time ?? 'default'}`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const consoleErrors = [], consoleWarnings = [], pageErrors = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error') consoleErrors.push(m.text().slice(0, 1500)); else if (t === 'warning') consoleWarnings.push(m.text().slice(0, 500)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 1500)));
  const url = buildUrl(o);
  const t0 = Date.now();
  let result = { url, out, ok: false };
  try {
    await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
    await page.waitForFunction(() => window.__city && window.__city.ready === true, null, { timeout: TIMEOUT, polling: 200 });
    const readyMs = Date.now() - t0;
    // stop the free-running rAF loop: frames are driven synchronously via step() from here on (keeps CPU load sane when many tools run)
    await page.evaluate(() => { window.__city.setLoop(false); window.__city.pause(true); });
    if (o.cam) await page.evaluate((c) => { if (!window.__city.setCamera(c)) { const m = c.match(/^([-\d.]+),([-\d.]+),([-\d.]+):([-\d.]+),([-\d.]+),([-\d.]+)$/); if (m) window.__city.setCamera({ position: [+m[1], +m[2], +m[3]], target: [+m[4], +m[5], +m[6]] }); } }, o.cam);
    if (o.time != null) await page.evaluate((t) => window.__city.setTime(t), o.time);
    if (o.weather) await page.evaluate((w) => window.__city.setWeather(w), o.weather);
    // settle: render N frames synchronously, then measure the last 60 with wall-clock timing
    const perf = await page.evaluate(async (frames) => {
      const c = window.__city;
      c.pause(true);
      c.step(Math.max(1, frames - 60));
      await new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      c.step(60);
      const ms = (performance.now() - t0) / 60;
      await new Promise((r) => requestAnimationFrame(r));
      return { ...c.stats(), frameMs: ms, fps: 1000 / ms };
    }, FRAMES);
    await page.screenshot({ path: out + '.png', type: 'png', timeout: 180000 });
    const failedModules = Object.entries(perf.modules).filter(([, v]) => v.status === 'failed' || v.status === 'missing').map(([k, v]) => `${k}:${v.status}`);
    result = {
      ok: pageErrors.length === 0 && perf.errors.length === 0 && consoleErrors.length === 0 && failedModules.length === 0,
      url, out: out + '.png', readyMs, frames: FRAMES, width: W, height: H,
      fps: +perf.fps.toFixed(1), frameMs: +perf.frameMs.toFixed(2), drawCalls: perf.drawCalls, triangles: perf.triangles, textures: perf.textures, geometries: perf.geometries, programs: perf.programs,
      hour: perf.hour, weather: perf.weather, mode: perf.mode, showcase: perf.showcase, seed: perf.seed, camera: perf.camera,
      modules: perf.modules, failedModules,
      errors: [...new Set([...pageErrors, ...perf.errors, ...consoleErrors])].slice(0, 50),
      warnings: [...new Set([...perf.warnings, ...consoleWarnings])].slice(0, 30),
      note: 'fps measured on SwiftShader (software GL): relative signal only. drawCalls/triangles are the hard numbers.',
    };
  } catch (e) {
    result = { ok: false, url, out: out + '.png', error: String(e.message || e), errors: [...pageErrors, ...consoleErrors] };
    try { await page.screenshot({ path: out + '.png', type: 'png' }); } catch {}
  }
  fs.writeFileSync(out + '.json', JSON.stringify(result, null, 2));
  await page.close();
  return result;
}

function standardSet() {
  const set = [];
  for (const m of MODULES) for (const t of TIMES) set.push({ showcase: m, time: t, out: `shots/all/${m}-${t}` });
  for (const cam of ['overview', 'district', 'street', 'skyline']) for (const t of TIMES) set.push({ cam, time: t, out: `shots/all/game-${cam}-${t}` });
  return set;
}

async function main() {
  if (args.list) { console.log(standardSet().map(buildUrl).join('\n')); return; }
  const release = await acquireSlot();
  process.on('exit', release);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const jobs = [];
  if (args.all) jobs.push(...standardSet());
  else if (args.showcases) for (const m of String(args.showcases).split(',')) for (const t of (args.times ? String(args.times).split(',').map(Number) : TIMES)) jobs.push({ showcase: m, time: t, cam: args.cam, out: `shots/${m}-${t}` });
  else jobs.push({ showcase: args.showcase, time: args.time != null ? Number(args.time) : undefined, cam: args.cam, seed: args.seed, weather: args.weather, quality: args.quality, only: args.only, extra: args.extra, out: args.out });
  let bad = 0;
  for (const j of jobs) {
    const r = await shoot(browser, j);
    if (!r.ok) bad++;
    const summary = r.error ? `ERROR ${r.error}` : `fps=${r.fps} ms=${r.frameMs} calls=${r.drawCalls} tris=${r.triangles} errors=${r.errors.length} failed=[${r.failedModules.join(',')}]`;
    console.log(`${r.ok ? 'OK ' : 'BAD'} ${r.out}  ${summary}`);
    if (!r.ok && r.errors?.length) for (const e of r.errors.slice(0, 5)) console.log('     ! ' + e.split('\n')[0]);
  }
  await browser.close();
  release();
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
