// ui module — Cities: Skylines II–class HUD. DOM only (0 draw calls). Owned by the ui builder.
// Reads world.sim / world.weather / ctx.clock, talks to other modules only through ctx.modules.X?.api with fallbacks.
import { CSS } from './styles.js';
import { icon, WEATHER_ICON } from './icons.js';
import { buildHud, el, fmtInt, fmtMoney, fmtSigned, fmtPct, fmtPct1, fmtTime, ZONE_COLORS, ZONE_LABELS, CATEGORIES } from './hud.js';

const WEATHER_ORDER = ['clear', 'overcast', 'rain', 'fog'];
const WEATHER_LABEL = { clear: 'Clear', overcast: 'Overcast', rain: 'Rain', fog: 'Fog' };
const FALLBACK_COSTS = { road: { alley: 6, local: 12, avenue: 24, highway: 48 }, zone: 10, terrain: 4 };
const COST_UNIT = { road: '/m', zone: '/cell', terrain: '/cell' };
const REFRESH = 0.1; // seconds between DOM refreshes (~10 Hz)

let S = null; // module state (single instance)

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

// ---------- data source: real world.sim, or fake data in the showcase ----------
function model() {
  const sim = S.fake || S.ctx.world.sim || {};
  return sim;
}
function costOf(tool, option) {
  const raw = safe(() => S.ctx.modules.simulation?.api?.costs, null);
  const c = typeof raw === 'function' ? safe(raw, null) : raw;
  const pick = (t) => (t && typeof t === 'object') ? t[option] : t;
  const v = pick(c?.[tool]) ?? pick(c?.[`${tool}s`]);
  if (typeof v === 'number') return v;
  const f = pick(FALLBACK_COSTS[tool]);
  return typeof f === 'number' ? f : null;
}

// ---------- refresh (throttled DOM writes, only when text changed) ----------
function setText(node, text) { if (node._t !== text) { node._t = text; node.textContent = text; } }
function setClass(node, cls, on) { if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on); }

function refresh(force) {
  const R = S.R, ctx = S.ctx, m = model(), clock = ctx.clock;
  const now = clock.elapsed;
  // money + delta colour
  const money = Number(m.money) || 0;
  if (S.money.last == null) S.money.last = money;
  else if (money !== S.money.last) { S.money.dir = money > S.money.last ? 1 : -1; S.money.t = now; S.money.last = money; }
  const st0 = m.stats || {};
  const perDay = st0.netIncome ?? st0.incomePerDay;
  const income = perDay ?? st0.income ?? S.income;
  const unit = perDay != null ? '/day' : '/h';
  setText(R.moneyV, fmtMoney(money));
  setText(R.moneySub, income == null ? `¤ 0 ${unit}` : `${fmtSigned(income)} ${unit}`);
  const flash = S.money.dir !== 0 && now - S.money.t < 1.6;
  setClass(R.money, 'up', flash ? S.money.dir > 0 : (income ?? 0) > 0);
  setClass(R.money, 'down', flash ? S.money.dir < 0 : (income ?? 0) < 0);
  // population, date, clock
  setText(R.popV, fmtInt(m.population));
  setText(R.dayV, `Day ${m.day ?? clock.day}`);
  setText(R.timeV, fmtTime(clock.hour));
  // speed buttons
  const paused = !!clock.paused;
  for (const k in R.speedBtns) setClass(R.speedBtns[k], 'active', k === 'pause' ? paused : (!paused && Number(k) === clock.speed));
  // time-of-day slider
  if (!R.sliderDrag) { const v = (Math.round(clock.hour * 4) / 4).toFixed(2); if (R.slider.value !== v) R.slider.value = v; }
  R.slider.title = `Time of day · ${fmtTime(clock.hour)}`;
  const night = clock.hour < 6 || clock.hour >= 19;
  if (S.night !== night) { S.night = night; R.todIcon.innerHTML = icon(night ? 'moon' : 'sun', 16); setClass(R.tod, 'night', night); }
  // weather
  const wk = ctx.world.weather?.kind || 'clear';
  if (S.weatherKind !== wk) { S.weatherKind = wk; R.weatherIcon.innerHTML = icon(WEATHER_ICON[wk] || 'sun', 16); R.weather.className = 'btn weather ' + wk; setText(R.weatherLbl, WEATHER_LABEL[wk] || wk); }
  // stats panel
  const pop = Number(m.population) || 0, jobs = Number(m.jobs) || 0, st = m.stats || {};
  setText(R.sPop, fmtInt(pop)); setText(R.sJobs, fmtInt(jobs));
  const unemp = st.unemployment ?? (pop > 0 ? Math.max(0, Math.min(1, (pop * 0.55 - jobs) / (pop * 0.55))) : null);
  setText(R.sUnemp, unemp == null ? '—' : fmtPct1(unemp));
  const hap = Number(m.happiness ?? 0.5);
  setText(R.sHappy, fmtPct(hap));
  const mood = hap >= 0.6 ? 'smile' : hap >= 0.4 ? 'meh' : 'frown';
  if (S.mood !== mood) { S.mood = mood; R.sHappyIcon.innerHTML = icon(mood, 15); setClass(R.sHappyRow, 'meh', mood === 'meh'); setClass(R.sHappyRow, 'sad', mood === 'frown'); R.happyBar.style.background = mood === 'smile' ? 'var(--ui-green)' : mood === 'meh' ? 'var(--ui-amber)' : 'var(--ui-red)'; }
  const hw = `${Math.round(hap * 100)}%`; if (R.happyBar.style.width !== hw) R.happyBar.style.width = hw;
  const tax = st.taxRate ?? st.tax ?? 0.1;
  setText(R.sTax, fmtPct(tax > 1 ? tax / 100 : tax));
  // RCI
  const d = m.demand || {};
  for (const k of ['res', 'com', 'ind']) {
    const f = Math.max(0, Math.min(1, Number(d[k]) || 0));
    const h = `${Math.round(f * 100)}%`;
    if (R.rciBars[k].style.height !== h) R.rciBars[k].style.height = h;
    setText(R.rciPct[k], h);
  }
  // perf
  if (S.perfOn || force) {
    const info = ctx.renderer?.info?.render, app = ctx.app;
    setText(R.pFps, Math.round(app?.fps > 0 ? app.fps : S.fps).toString());
    setText(R.pMs, app ? (app.frameMs || 0).toFixed(1) : '—');
    setText(R.pCalls, info ? fmtInt(info.calls) : '—');
    setText(R.pTris, info ? fmtInt(info.triangles) : '—');
    setText(R.pQ, ctx.quality || 'high');
  }
}

// ---------- tool state ----------
function catOf(tool) { return CATEGORIES.find((c) => c.tool === tool) || CATEGORIES[0]; }
function applyTool(tool, option, emit) {
  const R = S.R;
  const cat = catOf(tool);
  S.tool = cat.tool; S.option = cat.options ? (option && cat.options.some((o) => o.id === option) ? option : (S.lastOption[cat.id] || cat.options[0].id)) : null;
  if (cat.options) S.lastOption[cat.id] = S.option;
  S.openCat = cat.options ? cat.id : null;
  for (const id in R.catBtns) setClass(R.catBtns[id], 'active', id === cat.id);
  for (const id in R.subpanels) setClass(R.subpanels[id], 'on', id === S.openCat);
  for (const key in R.optBtns) setClass(R.optBtns[key], 'active', key === `${cat.id}/${S.option}`);
  if (emit) S.ctx.events.emit('ui:action', { action: 'tool', value: { tool: S.tool, option: S.option } });
}
function refreshCosts() {
  for (const key in S.R.optBtns) {
    const [cat, opt] = key.split('/');
    const c = costOf(cat, opt);
    S.R.optBtns[key]._cost.textContent = c == null ? '' : `¤ ${fmtInt(c)} ${COST_UNIT[cat] || ''}`;
  }
}

// ---------- toasts ----------
function notify(text, kind = 'info', opts = {}) {
  if (!S) return null;
  const R = S.R;
  const ic = { info: 'info', success: 'check', warn: 'warning', error: 'error' }[kind] || 'info';
  const t = el('div', { class: `panel toast ${kind}`, role: 'status' }, el('span', { html: icon(ic, 16) }), el('span', { class: 'txt', text: String(text) }), el('button', { class: 'btn icon', title: 'Dismiss', html: icon('close', 12), onclick: () => dismiss(t) }));
  R.toasts.appendChild(t);
  while (R.toasts.children.length > 5) R.toasts.firstChild.remove();
  const dur = opts.duration ?? (kind === 'error' ? 9000 : 5000);
  if (dur > 0) t._timer = setTimeout(() => dismiss(t), dur);
  return t;
}
function dismiss(t) {
  if (!t || !t.parentNode || t.classList.contains('out')) return;
  clearTimeout(t._timer); t.classList.add('out');
  setTimeout(() => t.remove(), 220);
}

// ---------- info card / hint ----------
function showInfo(info = {}) {
  if (!S) return;
  const R = S.R;
  R.icTitle.textContent = info.title ?? '';
  R.icSub.textContent = info.subtitle ?? '';
  R.icChip.style.background = info.color || (info.zone && ZONE_COLORS[info.zone]) || 'var(--ui-accent)';
  R.icBody.innerHTML = '';
  for (const r of info.rows || []) {
    const [label, value] = Array.isArray(r) ? r : [r?.label, r?.value];
    R.icBody.appendChild(el('div', { class: 'row' }, el('span', { class: 'l', text: String(label ?? '') }), el('span', { class: 'v', text: String(value ?? '') })));
  }
  R.icBody.style.display = (info.rows && info.rows.length) ? '' : 'none';
  R.infocard.classList.add('on');
  if (info.position && Number.isFinite(info.position.x) && Number.isFinite(info.position.y)) {
    R.infocard.classList.add('at');
    const w = 280, hEst = 60 + 24 * (info.rows?.length || 0) + 14;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = info.position.x + 18, y = info.position.y + 18;
    if (x + w > vw - 12) x = Math.max(12, info.position.x - w - 18);
    if (y + hEst > vh - 12) y = Math.max(12, vh - 12 - hEst);
    R.infocard.style.left = `${Math.round(x)}px`; R.infocard.style.top = `${Math.round(y)}px`; R.infocard.style.right = 'auto';
  } else { R.infocard.classList.remove('at'); R.infocard.style.left = ''; R.infocard.style.top = ''; R.infocard.style.right = ''; }
}
function hideInfo() { S?.R.infocard.classList.remove('on'); }
function setCursorHint(text) {
  if (!S) return;
  const on = text != null && text !== '';
  if (on) S.R.hint.textContent = String(text);
  setClass(S.R.hint, 'on', on);
}
function onPointerMove(e) {
  S.mouse.x = e.clientX; S.mouse.y = e.clientY;
  if (S.R.hint.classList.contains('on') && !S.hintRaf) {
    S.hintRaf = requestAnimationFrame(() => { S.hintRaf = 0; S.R.hint.style.transform = `translate(${S.mouse.x + 16}px, ${S.mouse.y + 20}px)`; });
  }
}

// ---------- settings / module status ----------
function togglePerf(on) {
  S.perfOn = on ?? !S.perfOn;
  setClass(S.R.perf, 'on', S.perfOn);
  setClass(S.R.toggles.perf, 'on', S.perfOn);
  if (S.perfOn) refresh(true);
}
function setSetting(key, value) {
  if (key === 'perf') { togglePerf(!!value); }
  else { S.settings[key] = value; setClass(S.R.toggles[key], 'on', !!value); }
  S.ctx.events.emit('ui:action', { action: 'setting', value: { key, value: !!value } });
}
function updateStatusDot(p) {
  if (p?.name) { if (p.status === 'failed' || p.status === 'missing') S.failed.set(p.name, `${p.name}: ${p.status}${p.error ? ' — ' + (p.error.message || p.error) : ''}`); else S.failed.delete(p.name); }
  for (const [n, m] of Object.entries(S.ctx.modules || {})) { if (m.status === 'failed' || m.status === 'missing') S.failed.set(n, `${n}: ${m.status}${m.error ? ' — ' + (m.error.message || m.error) : ''}`); else if (m.status === 'ok') S.failed.delete(n); }
  const bad = [...S.failed.values()];
  setClass(S.R.statusDot, 'on', bad.length > 0);
  S.R.statusDot.title = bad.length ? `Module problems:\n${bad.join('\n')}` : 'All modules OK';
}

// ---------- keyboard ----------
function onKeyDown(e) {
  if (isTyping(e.target)) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const R = S.R, clock = S.ctx.clock;
  switch (e.code) {
    case 'Escape':
      if (R.settings.classList.contains('on')) { R.settings.classList.remove('on'); break; }
      if (R.infocard.classList.contains('on')) { hideInfo(); break; }
      applyTool('none', null, true); break;
    case 'KeyR': applyTool('road', S.lastOption.road, true); break;
    case 'KeyZ': applyTool('zone', S.lastOption.zone, true); break;
    case 'KeyT': applyTool('terrain', S.lastOption.terrain, true); break;
    case 'KeyB': applyTool('bulldoze', null, true); break;
    case 'F3': e.preventDefault(); togglePerf(); break;
    case 'Space': e.preventDefault(); setSpeed('pause'); break;
    case 'Digit1': setSpeed(60); break;
    case 'Digit2': setSpeed(180); break;
    case 'Digit3': setSpeed(600); break;
    default: return;
  }
  refresh(true);
}
function setSpeed(id) {
  const clock = S.ctx.clock;
  if (id === 'pause') clock.paused = !clock.paused;
  else { clock.paused = false; clock.setSpeed(Number(id)); }
  S.ctx.events.emit('ui:action', { action: 'speed', value: { speed: clock.speed, paused: clock.paused } });
  refresh(true);
}

// ---------- module ----------
const api = {
  ZONE_COLORS, ZONE_LABELS,
  notify, showInfo, hideInfo, setCursorHint,
  setCityName(name) { if (S) { S.cityName = String(name); S.R.cityInput.value = S.cityName; } },
  getCityName() { return S?.cityName ?? 'New City'; },
  setTool(tool, option) { if (S) applyTool(tool, option, false); },
  getTool() { return { tool: S?.tool ?? 'none', option: S?.option ?? null }; },
  togglePerf(on) { if (S) togglePerf(on); },
  getSettings() { return S ? { ...S.settings, perf: S.perfOn } : {}; },
  refreshCosts() { if (S) refreshCosts(); },
  panels() { return S ? { root: S.R.root, topbar: S.R.topbar, toolbar: S.R.toolbar, stats: S.R.stats, rci: S.R.rci, perf: S.R.perf, infocard: S.R.infocard, settings: S.R.settings } : {}; },
};

export default {
  name: 'ui',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 0, triangles: 0 },

  async init(ctx) {
    const host = document.getElementById('ui') || document.body;
    S = {
      ctx, R: null, unsubs: [], acc: 0, fake: null, income: null,
      tool: 'none', option: null, openCat: null, lastOption: { road: 'local', zone: 'res-low', terrain: 'raise' },
      money: { last: null, dir: 0, t: 0 }, night: null, weatherKind: null, mood: null, perfOn: false,
      settings: { shadows: true, bloom: true, traffic: true, edgeScroll: false },
      fps: 60, failed: new Map(), cityName: ctx.params?.get('city') || 'New City', mouse: { x: 0, y: 0 }, hintRaf: 0, lastTickMoney: null,
    };
    const style = el('style', { id: 'hud-style', text: CSS });
    document.head.appendChild(style); S.style = style;

    const R = buildHud({
      cityName: (v) => { S.cityName = (v || '').trim() || 'New City'; R.cityInput.value = S.cityName; ctx.events.emit('ui:action', { action: 'cityName', value: S.cityName }); },
      speed: setSpeed,
      hour: (h) => { ctx.clock.setHour(h); refresh(true); },
      weather: () => {
        const cur = ctx.world.weather?.kind || 'clear';
        const next = WEATHER_ORDER[(WEATHER_ORDER.indexOf(cur) + 1) % WEATHER_ORDER.length];
        const fn = ctx.modules.environment?.api?.setWeather;
        if (typeof fn === 'function') safe(() => fn(next));
        else notify('Environment module is not available — weather request sent.', 'warn');
        ctx.events.emit('ui:action', { action: 'weather', value: next });
        refresh(true);
      },
      gear: () => { R.settings.classList.toggle('on'); },
      category: (id) => {
        const cat = CATEGORIES.find((c) => c.id === id);
        if (cat.options && S.openCat === id) { applyTool('none', null, true); return; }
        applyTool(cat.tool, S.lastOption[id], true);
      },
      option: (catId, optId) => { const cat = CATEGORIES.find((c) => c.id === catId); applyTool(cat.tool, optId, true); },
      setting: setSetting,
      quality: (q) => { if (q === ctx.quality) return; const u = new URL(location.href); u.searchParams.set('quality', q); location.href = u.toString(); },
      hideInfo,
      tax: (delta) => {
        const st = model().stats || {};
        const cur = Number(st.taxRate ?? st.tax ?? 0.1);
        const next = Math.max(0, Math.min(0.5, Math.round((cur + delta) * 100) / 100));
        if (S.fake) S.fake.stats.taxRate = next;
        const fn = ctx.modules.simulation?.api?.setTaxRate;
        if (typeof fn === 'function') safe(() => fn(next));
        ctx.events.emit('ui:action', { action: 'sim:setTaxRate', value: next });
        refresh(true);
      },
    });
    S.R = R; host.appendChild(R.root);
    R.cityInput.value = S.cityName;
    R.seedV.lastChild.textContent = String(ctx.world.seed ?? '—');
    for (const q in R.qBtns) setClass(R.qBtns[q], 'active', q === ctx.quality);
    refreshCosts();
    applyTool('none', null, false);

    // events
    const on = (n, f) => S.unsubs.push(ctx.events.on(n, f));
    on('sim:tick', (p) => {
      if (S.fake) return;
      const money = Number(p?.money ?? ctx.world.sim?.money);
      if (S.lastTickMoney != null && Number.isFinite(money) && ctx.world.sim?.stats?.netIncome == null) S.income = money - S.lastTickMoney;
      S.lastTickMoney = money;
      refresh(true);
    });
    on('time:changed', () => { S.acc = REFRESH; });
    on('weather:changed', () => refresh(true));
    on('tool:changed', (p) => { if (p && p.tool != null) applyTool(p.tool, p.option, false); });
    on('module:status', (p) => {
      updateStatusDot(p);
      if (p && (p.status === 'failed' || p.status === 'missing')) notify(`Module '${p.name}' ${p.status}${p.error ? ': ' + (p.error.message || p.error) : ''}`, 'error');
    });
    on('resize', () => { if (R.infocard.classList.contains('on') && R.infocard.classList.contains('at')) hideInfo(); });
    window.addEventListener('keydown', onKeyDown); window.addEventListener('pointermove', onPointerMove, { passive: true });
    // close settings when clicking outside it
    S.onDocDown = (e) => { if (R.settings.classList.contains('on') && !R.settings.contains(e.target) && !R.gear.contains(e.target)) R.settings.classList.remove('on'); };
    window.addEventListener('pointerdown', S.onDocDown, true);

    updateStatusDot();
    refresh(true);
    ctx.log('ui: HUD ready');
  },

  update(dt, ctx) {
    if (!S) return;
    if (dt > 0) S.fps += ((1 / dt) - S.fps) * 0.08;
    S.acc += dt;
    if (S.acc < REFRESH) return;
    S.acc = 0;
    refresh(false);
  },

  async showcase(ctx) {
    // Plausible fake data so one screenshot judges the whole HUD. No 3D objects, no world writes.
    S.fake = {
      day: 12, population: 48213, jobs: 21940, money: 1284560, happiness: 0.78,
      demand: { res: 0.62, com: 0.45, ind: 0.71 },
      stats: { unemployment: 0.042, taxRate: 0.11, netIncome: 12840 },
    };
    api.setCityName('Riverside');
    applyTool('road', 'avenue', false);
    togglePerf(true);
    notify('Avenue upgrade completed on Riverside Boulevard.', 'success', { duration: 0 });
    notify('124 new residents moved into Maple Heights.', 'info', { duration: 0 });
    showInfo({
      title: 'Maple Street 12', subtitle: 'Residential · Low density · Level 3', zone: 'res-low',
      rows: [['Residents', '14 / 16'], ['Happiness', '82%'], ['Land value', '¤ 3,420'], ['Age', 'Day 4'], ['Services', 'All connected']],
    });
    S.mouse.x = Math.round(window.innerWidth * 0.6); S.mouse.y = Math.round(window.innerHeight * 0.6);
    setCursorHint('Avenue · 96 m · ¤ 3,120');
    S.R.hint.style.transform = `translate(${S.mouse.x + 16}px, ${S.mouse.y + 20}px)`;
    refresh(true);
    ctx.log('ui: showcase staged');
  },

  dispose(ctx) {
    if (!S) return;
    for (const u of S.unsubs) safe(u);
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('pointermove', onPointerMove);
    if (S.onDocDown) window.removeEventListener('pointerdown', S.onDocDown, true);
    S.R?.root?.remove(); S.style?.remove();
    S = null;
  },

  api,
};
