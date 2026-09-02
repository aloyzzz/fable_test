// DOM dashboard for the simulation showcase (0 WebGL draw calls). Dark glass game HUD:
// KPI tiles, RCI demand bars, population/money sparklines, a live zoning minimap and an event feed.
export const ZONE_COLORS = {
  'res-low': '#4ade80', 'res-high': '#22c55e',
  'com-low': '#60a5fa', 'com-high': '#3b82f6',
  ind: '#fbbf24', office: '#c084fc',
};
export const ZONE_LABELS = {
  'res-low': 'Residential · low', 'res-high': 'Residential · high',
  'com-low': 'Commercial · low', 'com-high': 'Commercial · high',
  ind: 'Industrial', office: 'Office',
};

const CSS = `
.sim-hud{position:fixed;left:24px;bottom:24px;width:760px;box-sizing:border-box;padding:14px 16px 12px;color:#e6edf7;
  font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums;
  background:linear-gradient(160deg,rgba(16,22,36,.88),rgba(7,10,18,.94));border:1px solid rgba(255,255,255,.09);
  border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07);
  backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);user-select:none}
.sim-hud *{box-sizing:border-box}
.sim-hud .hd{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.sim-hud .brand{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#8fa3c2}
.sim-hud .city{font-size:16px;font-weight:600;letter-spacing:.01em}
.sim-hud .sp{flex:1}
.sim-hud .chip{padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);font-size:11.5px;color:#c9d5e8;white-space:nowrap}
.sim-hud .chip b{color:#fff;font-weight:600}
.sim-hud .chip.speed{color:#67e8f9;border-color:rgba(103,232,249,.25);background:rgba(103,232,249,.08)}
.sim-hud .grid{display:grid;grid-template-columns:1fr 216px;gap:12px}
.sim-hud .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
.sim-hud .kpi{padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06)}
.sim-hud .kpi .l{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8fa3c2}
.sim-hud .kpi .v{font-size:20px;font-weight:650;margin-top:2px;line-height:1.1;color:#fff}
.sim-hud .kpi .s{font-size:11px;color:#9fb2cf;margin-top:3px;min-height:14px}
.sim-hud .up{color:#4ade80}.sim-hud .dn{color:#f87171}.sim-hud .mid{color:#fbbf24}
.sim-hud .bar{height:5px;border-radius:3px;background:rgba(255,255,255,.08);margin-top:6px;overflow:hidden}
.sim-hud .bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#f87171,#fbbf24 45%,#4ade80);transition:width .4s}
.sim-hud .mid-row{display:grid;grid-template-columns:150px 1fr;gap:8px}
.sim-hud .rci{padding:8px 10px 6px;border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06)}
.sim-hud .rci .l{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8fa3c2;margin-bottom:6px}
.sim-hud .rci .bars{display:flex;justify-content:space-around;align-items:flex-end;height:84px;padding:0 4px}
.sim-hud .rci .col{width:26px;display:flex;flex-direction:column;align-items:center;height:100%}
.sim-hud .rci .trk{flex:1;width:100%;border-radius:5px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden}
.sim-hud .rci .fil{position:absolute;left:0;right:0;bottom:0;height:0;border-radius:4px;transition:height .5s;box-shadow:0 0 12px var(--c)}
.sim-hud .rci .fil::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,.25),transparent 60%)}
.sim-hud .rci .k{margin-top:4px;font-size:11px;font-weight:700;letter-spacing:.05em}
.sim-hud .rci .pct{font-size:9.5px;color:#9fb2cf}
.sim-hud .sparks{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sim-hud .spark{padding:8px 10px 6px;border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06)}
.sim-hud .spark .l{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8fa3c2}
.sim-hud .spark .l b{color:#fff;letter-spacing:0;text-transform:none;font-size:12px}
.sim-hud .spark canvas{display:block;width:100%;height:64px;margin-top:4px}
.sim-hud .map{border-radius:10px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06);padding:8px;display:flex;flex-direction:column}
.sim-hud .map .l{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8fa3c2;display:flex;justify-content:space-between}
.sim-hud .map canvas{display:block;width:100%;height:194px;margin-top:6px;border-radius:6px}
.sim-hud .legend{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:6px;font-size:10px;color:#9fb2cf}
.sim-hud .legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.sim-hud .ft{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07)}
.sim-hud .ft .chip{font-size:11px;padding:2px 8px}
.sim-hud .ok{color:#4ade80}.sim-hud .bad{color:#f87171}
.sim-hud .feed{margin-top:8px;font-size:11px;color:#9fb2cf;display:flex;flex-direction:column;gap:2px;min-height:34px}
.sim-hud .feed div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sim-hud .feed div:first-child{color:#e6edf7}
.sim-hud .feed .t{color:#67e8f9;margin-right:6px}
`;

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtMoney = (n) => (n < 0 ? '−$' : '$') + fmtInt(Math.abs(n));
const fmtSigned = (n, unit = '') => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtInt(Math.abs(n)) + unit;
const pad2 = (n) => String(n).padStart(2, '0');

function injectStyle() {
  if (document.getElementById('sim-hud-style')) return;
  const st = document.createElement('style'); st.id = 'sim-hud-style'; st.textContent = CSS; document.head.appendChild(st);
}

function drawSpark(canvas, values, color, { fmt = fmtInt, zeroLine = false } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 200, h = canvas.clientHeight || 64;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const n = values.length;
  const padT = 12, padB = 12, padL = 3, padR = 8;
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (zeroLine) { min = Math.min(min, 0); }
  if (max - min < 1e-6) { max = min + 1; }
  const span = max - min;
  const X = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const Y = (v) => padT + (1 - (v - min) / span) * (h - padT - padB);
  // grid
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
  for (let k = 0; k <= 2; k++) { const y = padT + (k / 2) * (h - padT - padB); g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(w - padR, y + .5); g.stroke(); }
  if (zeroLine && min < 0) { const y = Y(0); g.strokeStyle = 'rgba(248,113,113,.5)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(w - padR, y + .5); g.stroke(); g.setLineDash([]); }
  if (n >= 2) {
    const grad = g.createLinearGradient(0, padT, 0, h);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
    g.beginPath(); g.moveTo(X(0), Y(values[0]));
    for (let i = 1; i < n; i++) g.lineTo(X(i), Y(values[i]));
    g.lineTo(X(n - 1), h - padB); g.lineTo(X(0), h - padB); g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath(); g.moveTo(X(0), Y(values[0]));
    for (let i = 1; i < n; i++) g.lineTo(X(i), Y(values[i]));
    g.strokeStyle = color; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    const lx = X(n - 1), ly = Y(values[n - 1]);
    g.fillStyle = color; g.beginPath(); g.arc(lx, ly, 2.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(lx, ly, 5.5, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#8fa3c2'; g.font = '9.5px system-ui, sans-serif'; g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText(fmt(max), padL + 1, 5);
  g.textAlign = 'right'; g.fillText(fmt(min), w - 2, h - 5);
}

/**
 * createHud(root, { city, mapPainter }) → { el, update(model, extra), pushFeed(text), dispose() }
 *  mapPainter(g2d, w, h) paints the minimap; extra = { speed, paused }
 */
export function createHud(root, { city = 'Showcase City', mapPainter = null } = {}) {
  injectStyle();
  const el = document.createElement('div');
  el.className = 'sim-hud';
  el.innerHTML = `
    <div class="hd">
      <div><div class="brand">Skylines-3 · City Simulation</div><div class="city">${city}</div></div>
      <div class="sp"></div>
      <span class="chip" data-k="clock"><b>Day 1</b> · 00:00</span>
      <span class="chip speed" data-k="speed">×60</span>
      <span class="chip" data-k="tax">Tax <b>10%</b></span>
    </div>
    <div class="grid">
      <div>
        <div class="kpis">
          <div class="kpi"><div class="l">Population</div><div class="v" data-k="pop">0</div><div class="s" data-k="pop-s"></div></div>
          <div class="kpi"><div class="l">Treasury</div><div class="v" data-k="money">$0</div><div class="s" data-k="money-s"></div></div>
          <div class="kpi"><div class="l">Happiness</div><div class="v" data-k="happy">0%</div><div class="bar"><i data-k="happy-bar"></i></div></div>
          <div class="kpi"><div class="l">Jobs</div><div class="v" data-k="jobs">0</div><div class="s" data-k="jobs-s"></div></div>
        </div>
        <div class="mid-row">
          <div class="rci"><div class="l">Demand</div>
            <div class="bars">
              <div class="col"><div class="trk"><div class="fil" data-k="d-res" style="--c:#4ade80;background:#4ade80"></div></div><div class="k" style="color:#4ade80">R</div><div class="pct" data-k="p-res">0%</div></div>
              <div class="col"><div class="trk"><div class="fil" data-k="d-com" style="--c:#60a5fa;background:#60a5fa"></div></div><div class="k" style="color:#60a5fa">C</div><div class="pct" data-k="p-com">0%</div></div>
              <div class="col"><div class="trk"><div class="fil" data-k="d-ind" style="--c:#fbbf24;background:#fbbf24"></div></div><div class="k" style="color:#fbbf24">I</div><div class="pct" data-k="p-ind">0%</div></div>
            </div>
          </div>
          <div class="sparks">
            <div class="spark"><div class="l"><span>Population</span><b data-k="spark-pop-v"></b></div><canvas data-k="spark-pop"></canvas></div>
            <div class="spark"><div class="l"><span>Treasury</span><b data-k="spark-money-v"></b></div><canvas data-k="spark-money"></canvas></div>
          </div>
        </div>
        <div class="feed" data-k="feed"></div>
      </div>
      <div class="map"><div class="l"><span>Districts</span><span data-k="map-s"></span></div><canvas data-k="map"></canvas>
        <div class="legend">${Object.keys(ZONE_COLORS).map((z) => `<span><i style="background:${ZONE_COLORS[z]}"></i>${ZONE_LABELS[z].replace(' · ', ' ')}</span>`).join('')}</div>
      </div>
    </div>
    <div class="ft">
      <span class="chip">Households <b data-k="hh">0</b></span>
      <span class="chip">Workers <b data-k="wrk">0</b></span>
      <span class="chip">Buildings <b data-k="bld">0</b></span>
      <span class="chip">Avg level <b data-k="lvl">–</b></span>
      <span class="chip">Vacant lots <b data-k="vac">0</b></span>
      <span class="chip">Roads <b data-k="roads">0 km</b></span>
      <span class="chip">Income <b data-k="inc">$0/day</b></span>
      <span class="chip">Upkeep <b data-k="upk">$0/day</b></span>
      <span class="chip">Power <b class="ok" data-k="power">✓</b></span>
      <span class="chip">Water <b class="ok" data-k="water">✓</b></span>
      <span class="chip">Traffic <b data-k="traffic">0%</b></span>
    </div>`;
  root.appendChild(el);
  const q = (k) => el.querySelector(`[data-k="${k}"]`);
  const feed = [];
  const $ = {
    clock: q('clock'), speed: q('speed'), tax: q('tax'), pop: q('pop'), popS: q('pop-s'), money: q('money'), moneyS: q('money-s'),
    happy: q('happy'), happyBar: q('happy-bar'), jobs: q('jobs'), jobsS: q('jobs-s'),
    dRes: q('d-res'), dCom: q('d-com'), dInd: q('d-ind'), pRes: q('p-res'), pCom: q('p-com'), pInd: q('p-ind'),
    sparkPop: q('spark-pop'), sparkMoney: q('spark-money'), sparkPopV: q('spark-pop-v'), sparkMoneyV: q('spark-money-v'),
    map: q('map'), mapS: q('map-s'), feed: q('feed'),
    hh: q('hh'), wrk: q('wrk'), bld: q('bld'), lvl: q('lvl'), vac: q('vac'), roads: q('roads'), inc: q('inc'), upk: q('upk'), power: q('power'), water: q('water'), traffic: q('traffic'),
  };

  function paintMap() {
    if (!mapPainter) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = $.map.clientWidth || 198, h = $.map.clientHeight || 194;
    if ($.map.width !== Math.round(w * dpr) || $.map.height !== Math.round(h * dpr)) { $.map.width = Math.round(w * dpr); $.map.height = Math.round(h * dpr); }
    const g = $.map.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    mapPainter(g, w, h);
  }

  function update(model, extra = {}) {
    const s = model.stats || {};
    const d = model.demand;
    const hh = Math.floor(model.hour), mm = Math.floor((model.hour - hh) * 60);
    $.clock.innerHTML = `<b>Day ${model.day}</b> · ${pad2(hh)}:${pad2(mm)}`;
    $.speed.textContent = extra.paused && !extra.autorun ? 'paused' : `×${fmtInt(extra.speed ?? 60)}`;
    $.tax.innerHTML = `Tax <b>${Math.round(model.taxRate * 100)}%</b>`;
    $.pop.textContent = fmtInt(model.population);
    const gr = s.growthRate ?? 0;
    $.popS.innerHTML = `<span class="${gr > 0.5 ? 'up' : gr < -0.5 ? 'dn' : ''}">${fmtSigned(gr)} / day</span>`;
    $.money.textContent = fmtMoney(model.money);
    $.money.className = 'v' + (model.money < 0 ? ' dn' : '');
    const net = s.netIncome ?? 0;
    $.moneyS.innerHTML = `<span class="${net >= 0 ? 'up' : 'dn'}">${fmtSigned(net)} / day</span>`;
    const hp = Math.round(model.happiness * 100);
    $.happy.textContent = hp + '%';
    $.happy.className = 'v ' + (hp >= 60 ? 'up' : hp >= 40 ? 'mid' : 'dn');
    $.happyBar.style.width = hp + '%';
    $.jobs.textContent = fmtInt(model.jobs);
    const un = Math.round((s.unemployment ?? 0) * 100);
    $.jobsS.innerHTML = `<span class="${un > 15 ? 'dn' : un > 6 ? 'mid' : ''}">${un}% unemployed</span>`;
    $.hh.textContent = fmtInt(s.households ?? 0); $.wrk.textContent = fmtInt(s.workers ?? 0);
    $.dRes.style.height = Math.round(d.res * 100) + '%'; $.pRes.textContent = Math.round(d.res * 100) + '%';
    $.dCom.style.height = Math.round(d.com * 100) + '%'; $.pCom.textContent = Math.round(d.com * 100) + '%';
    $.dInd.style.height = Math.round(d.ind * 100) + '%'; $.pInd.textContent = Math.round(d.ind * 100) + '%';
    const H = model.history;
    drawSpark($.sparkPop, H.pop, '#4ade80');
    drawSpark($.sparkMoney, H.money, '#67e8f9', { fmt: (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'k' : fmtInt(v)), zeroLine: true });
    $.sparkPopV.textContent = `${H.pop.length}h`;
    $.sparkMoneyV.textContent = `${H.money.length}h`;
    $.bld.textContent = fmtInt(s.buildings ?? 0);
    $.lvl.textContent = s.buildings ? (s.avgLevel ?? 1).toFixed(2) : '–';
    $.vac.textContent = fmtInt(s.vacantLots ?? 0);
    $.roads.textContent = ((s.roadMeters ?? 0) / 1000).toFixed(1) + ' km';
    $.inc.textContent = fmtMoney(s.taxIncome ?? 0) + '/day';
    $.upk.textContent = fmtMoney(s.upkeep ?? 0) + '/day';
    $.power.textContent = s.powerOk === false ? '✕' : '✓'; $.power.className = s.powerOk === false ? 'bad' : 'ok';
    $.water.textContent = s.waterOk === false ? '✕' : '✓'; $.water.className = s.waterOk === false ? 'bad' : 'ok';
    const tr = Math.round((s.traffic ?? 0) * 100);
    $.traffic.textContent = tr + '%'; $.traffic.className = tr > 60 ? 'bad' : tr > 30 ? 'mid' : 'ok';
    $.mapS.textContent = `${fmtInt(s.buildings ?? 0)} / ${fmtInt(s.zonedLots ?? 0)} lots built`;
    paintMap();
  }

  function pushFeed(text, when) {
    feed.unshift({ text, when });
    if (feed.length > 3) feed.length = 3;
    $.feed.innerHTML = feed.map((f) => `<div><span class="t">${f.when}</span>${f.text}</div>`).join('');
  }

  function dispose() { el.remove(); }
  return { el, update, pushFeed, paintMap, dispose };
}
