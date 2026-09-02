// DOM construction for the HUD. Pure builders: no game state here, only refs + callbacks.
import { icon } from './icons.js';

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) { if (c == null || c === false) continue; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return n;
}

export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const fmtMoney = (n) => (n < 0 ? '−¤ ' : '¤ ') + fmtInt(Math.abs(n));
export const fmtSigned = (n) => (n < 0 ? '−' : '+') + '¤ ' + fmtInt(Math.abs(n));
export const fmtPct = (f) => `${Math.round((Number(f) || 0) * 100)}%`;
export const fmtPct1 = (f) => `${((Number(f) || 0) * 100).toFixed(1)}%`;
export function fmtTime(hour) {
  const h = ((hour % 24) + 24) % 24; const hh = Math.floor(h); const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const ZONE_COLORS = {
  'res-low':  '#6cc86a',
  'res-high': '#2f9a5b',
  'com-low':  '#5aa9ff',
  'com-high': '#2f6fd6',
  'ind':      '#e8a437',
  'office':   '#a57df0',
};
export const ZONE_LABELS = {
  'res-low': ['Residential', 'Low density'], 'res-high': ['Residential', 'High density'],
  'com-low': ['Commercial', 'Low density'], 'com-high': ['Commercial', 'High density'],
  'ind': ['Industrial', 'Manufacturing'], 'office': ['Office', 'High density'],
};

export const CATEGORIES = [
  { id: 'none', tool: 'none', label: 'Select', icon: 'select', key: 'Esc', code: 'Escape' },
  { id: 'road', tool: 'road', label: 'Roads', icon: 'road', key: 'R', code: 'KeyR', options: [
    { id: 'alley', label: 'Alley', icon: 'alley', sub: '8 m · 2 lanes' },
    { id: 'local', label: 'Local', icon: 'local', sub: '16 m · 2 lanes' },
    { id: 'avenue', label: 'Avenue', icon: 'avenue', sub: '24 m · 4 lanes' },
    { id: 'highway', label: 'Highway', icon: 'highway', sub: '32 m · 6 lanes' },
  ] },
  { id: 'zone', tool: 'zone', label: 'Zoning', icon: 'zone', key: 'Z', code: 'KeyZ', options: Object.keys(ZONE_COLORS).map((id) => ({ id, label: ZONE_LABELS[id][0], sub: ZONE_LABELS[id][1], zone: id })) },
  { id: 'terrain', tool: 'terrain', label: 'Terrain', icon: 'terrain', key: 'T', code: 'KeyT', options: [
    { id: 'raise', label: 'Raise', icon: 'raise', sub: 'Brush' }, { id: 'lower', label: 'Lower', icon: 'lower', sub: 'Brush' },
    { id: 'flatten', label: 'Flatten', icon: 'flatten', sub: 'Level to point' }, { id: 'smooth', label: 'Smooth', icon: 'smooth', sub: 'Brush' },
  ] },
  { id: 'bulldoze', tool: 'bulldoze', label: 'Bulldoze', icon: 'bulldoze', key: 'B', code: 'KeyB', danger: true },
];

const SPEEDS = [
  { id: 'pause', icon: 'pause', title: 'Pause (Space)' },
  { id: 60, label: '1×', title: 'Normal speed (1)' },
  { id: 180, label: '2×', title: 'Fast (2)' },
  { id: 600, label: '3×', title: 'Fastest (3)' },
];

export function buildHud(cb) {
  const R = {}; // refs
  const root = el('div', { id: 'hud' });
  R.root = root;

  // ---------- top bar ----------
  R.cityInput = el('input', { type: 'text', value: 'New City', maxlength: '28', spellcheck: 'false', title: 'City name (click to rename)',
    onchange: (e) => cb.cityName(e.target.value), onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); e.stopPropagation(); } });
  R.moneyV = el('span', { class: 'v', text: '¤ 0' });
  R.moneySub = el('span', { class: 'sub', text: '¤ 0 /h' });
  R.money = el('div', { class: 'stat money', title: 'Treasury · income per game hour' }, el('span', { html: icon('coin', 16) }), R.moneyV, R.moneySub);
  R.popV = el('span', { class: 'v', text: '0' });
  R.pop = el('div', { class: 'stat pop', title: 'Population' }, el('span', { html: icon('people', 16) }), R.popV);
  R.dayV = el('span', { class: 'dv', text: 'Day 1' });
  R.timeV = el('span', { class: 't', text: '00:00' });
  R.speedBtns = {};
  const seg = el('div', { class: 'seg' });
  for (const s of SPEEDS) {
    const b = el('button', { class: 'btn' + (s.icon ? ' icon' : ''), title: s.title, html: s.icon ? icon(s.icon, 14) : '', onclick: () => cb.speed(s.id) });
    if (s.label) b.textContent = s.label;
    R.speedBtns[s.id] = b; seg.appendChild(b);
  }
  R.todIcon = el('span', { html: icon('sun', 16) });
  R.slider = el('input', { type: 'range', class: 'slider', min: '0', max: '24', step: '0.25', value: '14', title: 'Time of day',
    oninput: (e) => cb.hour(Number(e.target.value)), onpointerdown: () => (R.sliderDrag = true), onpointerup: () => (R.sliderDrag = false), onkeydown: (e) => e.stopPropagation() });
  R.tod = el('div', { class: 'tod' }, R.todIcon, R.slider);
  R.weatherIcon = el('span', { html: icon('sun', 16) });
  R.weatherLbl = el('span', { text: 'Clear' });
  R.weather = el('button', { class: 'btn weather clear', title: 'Weather (click to cycle)', onclick: cb.weather }, R.weatherIcon, R.weatherLbl);
  R.statusDot = el('span', { class: 'statusdot', title: 'All modules OK' }, el('i'));
  R.gear = el('button', { class: 'btn icon', title: 'Settings', html: icon('gear', 16), onclick: cb.gear });
  R.topbar = el('div', { class: 'panel topbar' },
    el('div', { class: 'cityname' }, el('span', { html: icon('city', 18) }), R.cityInput),
    el('div', { class: 'sep' }), R.money, R.pop,
    el('div', { class: 'grow' }),
    el('div', { class: 'datetime' }, el('span', { class: 'd' }, el('span', { html: icon('calendar', 15) }), R.dayV), el('span', { class: 'd' }, el('span', { html: icon('clock', 15) }), R.timeV)),
    seg,
    el('div', { class: 'sep' }), R.tod,
    el('div', { class: 'sep' }), R.weather,
    el('div', { class: 'sep' }), R.statusDot, R.gear,
  );
  root.appendChild(R.topbar);

  // ---------- stats panel (left) ----------
  const statRow = (ico, label, cls = '') => { const v = el('span', { class: 'v', text: '—' }); const row = el('div', { class: 'row ' + cls }, el('span', { html: icon(ico, 15) }), el('span', { class: 'l', text: label }), v); return { row, v }; }
  const sPop = statRow('people', 'Population'), sJobs = statRow('briefcase', 'Jobs'), sUnemp = statRow('activity', 'Unemployment'), sHappy = statRow('smile', 'Happiness', 'happy'), sTax = statRow('percent', 'Tax rate');
  R.sPop = sPop.v; R.sJobs = sJobs.v; R.sUnemp = sUnemp.v; R.sHappy = sHappy.v; R.sHappyRow = sHappy.row; R.sHappyIcon = sHappy.row.firstChild; R.sTax = sTax.v;
  R.happyBar = el('i');
  sTax.row.appendChild(el('span', { class: 'stepper' },
    el('button', { class: 'btn icon', title: 'Lower taxes 1%', html: icon('minus', 12), onclick: () => cb.tax(-0.01) }),
    el('button', { class: 'btn icon', title: 'Raise taxes 1%', html: icon('plus', 12), onclick: () => cb.tax(0.01) })));
  R.stats = el('div', { class: 'panel stats' }, el('div', { class: 'card-title' }, el('span', { text: 'City overview' })), sPop.row, sJobs.row, sUnemp.row, sHappy.row, el('div', { class: 'minibar' }, R.happyBar), sTax.row);
  root.appendChild(R.stats);

  // ---------- RCI (bottom-left) ----------
  R.rciBars = {}; R.rciPct = {};
  const bars = el('div', { class: 'bars' });
  for (const [k, l] of [['res', 'R'], ['com', 'C'], ['ind', 'I']]) {
    const fill = el('i'); const pct = el('span', { class: 'pct', text: '0%' });
    R.rciBars[k] = fill; R.rciPct[k] = pct;
    bars.appendChild(el('div', { class: 'col ' + k, title: { res: 'Residential demand', com: 'Commercial demand', ind: 'Industrial demand' }[k] }, pct, el('div', { class: 'bar ' + k }, fill), el('span', { class: 'lbl', text: l })));
  }
  R.rci = el('div', { class: 'panel rci' }, el('div', { class: 'card-title' }, el('span', { text: 'Demand' })), bars);
  root.appendChild(R.rci);

  // ---------- toasts (top-right) ----------
  R.toasts = el('div', { class: 'toasts' });
  root.appendChild(R.toasts);

  // ---------- perf (bottom-right) ----------
  const perfRow = (label) => { const v = el('span', { class: 'v', text: '—' }); return { row: el('div', { class: 'row' }, el('span', { class: 'l', text: label }), v), v }; };
  const pFps = perfRow('fps'), pMs = perfRow('frame ms'), pCalls = perfRow('draw calls'), pTris = perfRow('triangles'), pQ = perfRow('quality');
  R.pFps = pFps.v; R.pMs = pMs.v; R.pCalls = pCalls.v; R.pTris = pTris.v; R.pQ = pQ.v;
  R.perf = el('div', { class: 'panel perf' }, el('div', { class: 'card-title' }, el('span', { text: 'Performance' }), el('span', { class: 'kbd', text: 'F3' })), pFps.row, pMs.row, pCalls.row, pTris.row, pQ.row);
  root.appendChild(R.perf);

  // ---------- info card + cursor hint ----------
  R.icChip = el('span', { class: 'chip' }); R.icTitle = el('b', { text: '' }); R.icSub = el('span', { text: '' }); R.icBody = el('div', { class: 'bd' });
  R.infocard = el('div', { class: 'panel infocard' },
    el('div', { class: 'hd' }, R.icChip, el('div', { class: 'ttl' }, R.icTitle, R.icSub), el('button', { class: 'btn icon', title: 'Close', html: icon('close', 14), onclick: cb.hideInfo })),
    R.icBody);
  root.appendChild(R.infocard);
  R.hint = el('div', { class: 'hint' });
  root.appendChild(R.hint);

  // ---------- toolbar (bottom-center) ----------
  R.catBtns = {}; R.optBtns = {}; R.subpanels = {};
  R.toolbar = el('div', { class: 'panel toolbar' });
  for (const c of CATEGORIES) {
    const b = el('button', { class: 'btn cat' + (c.danger ? ' danger' : ''), title: `${c.label} (${c.key})`, onclick: () => cb.category(c.id) }, el('span', { html: icon(c.icon, 20) }), el('span', { text: c.label }));
    R.catBtns[c.id] = b; R.toolbar.appendChild(b);
    if (c.options) {
      const opts = el('div', { class: 'opts' });
      for (const o of c.options) {
        const costEl = el('span', { class: 'cost', text: '' });
        const glyph = o.zone ? el('span', { class: 'zchip', style: `background:${ZONE_COLORS[o.zone]};color:${ZONE_COLORS[o.zone]}` }) : el('span', { html: icon(o.icon, 22) });
        const ob = el('button', { class: 'btn opt', title: o.label, onclick: () => cb.option(c.id, o.id) }, glyph, el('span', { text: o.label }), el('span', { class: 'sub', text: o.sub || '' }), costEl);
        ob._cost = costEl;
        R.optBtns[`${c.id}/${o.id}`] = ob; opts.appendChild(ob);
      }
      const sp = el('div', { class: 'panel subpanel' }, el('div', { class: 'hd' }, el('span', { text: c.label }), el('span', { class: 'kbd', text: c.key })), opts);
      R.subpanels[c.id] = sp; root.appendChild(sp);
    }
  }
  root.appendChild(R.toolbar);

  // ---------- settings popover ----------
  R.qBtns = {};
  const qseg = el('div', { class: 'seg' });
  for (const q of ['low', 'high']) { const b = el('button', { class: 'btn', text: q[0].toUpperCase() + q.slice(1), onclick: () => cb.quality(q) }); R.qBtns[q] = b; qseg.appendChild(b); }
  R.seedV = el('span', { class: 'v' }, el('span', { html: icon('hash', 13) }), el('span', { text: '—' }));
  R.toggles = {};
  const toggleRow = (key, label, on) => { const t = el('span', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', onclick: () => cb.setting(key, !t.classList.contains('on')) }); R.toggles[key] = t; return el('div', { class: 'row' }, el('span', { class: 'l', text: label }), t); };
  R.settings = el('div', { class: 'panel settings' },
    el('div', { class: 'card-title' }, el('span', { text: 'Settings' }), el('button', { class: 'btn icon', title: 'Close', html: icon('close', 14), onclick: cb.gear })),
    el('div', { class: 'row' }, el('span', { class: 'l', text: 'Quality' }), qseg),
    el('div', { class: 'row' }, el('span', { class: 'l', text: 'World seed' }), R.seedV),
    el('div', { class: 'sect', text: 'Rendering' }),
    toggleRow('shadows', 'Shadows', true), toggleRow('bloom', 'Bloom & post-processing', true), toggleRow('traffic', 'Traffic simulation', true),
    el('div', { class: 'sect', text: 'Interface' }),
    toggleRow('perf', 'Performance readout', false), toggleRow('edgeScroll', 'Edge scrolling', false),
    el('div', { class: 'hintline' }, el('span', { html: icon('reload', 12) }), el('span', { text: 'Quality changes reload the page.' })),
  );
  root.appendChild(R.settings);
  return R;
}
