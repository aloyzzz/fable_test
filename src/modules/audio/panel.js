// Showcase / debug panel: dark-glass DOM overlay with a master spectrum, per-layer level meters and the mapped
// mix parameters. Pure DOM (0 WebGL draw calls). Only created in showcase mode or via api.showPanel(true).
const CSS = `
.au-panel{position:absolute;top:22px;right:22px;width:372px;box-sizing:border-box;padding:16px 18px 14px;border-radius:16px;
 background:linear-gradient(160deg,rgba(20,26,44,.9),rgba(8,11,20,.94)); border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08);color:#e9edf5;
 font:12px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;user-select:none}
.au-h{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.au-dot{width:9px;height:9px;border-radius:50%;background:#ff5d73;box-shadow:0 0 0 3px rgba(255,93,115,.18)}
.au-dot.on{background:#3fd3a4;box-shadow:0 0 0 3px rgba(63,211,164,.18),0 0 12px rgba(63,211,164,.6)}
.au-title{font-weight:650;font-size:13.5px;letter-spacing:.06em;text-transform:uppercase}
.au-sub{margin-left:auto;font-size:10.5px;color:#9aa6bd;text-align:right}
.au-pill{font-size:10px;font-weight:700;letter-spacing:.08em;padding:2px 7px;border-radius:20px;background:rgba(255,93,115,.18);color:#ff8a9a}
.au-pill.on{background:rgba(63,211,164,.16);color:#6fe8c2}
.au-spec{display:block;width:100%;height:58px;border-radius:8px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.06);margin:2px 0 10px}
.au-row{display:grid;grid-template-columns:96px 1fr 52px;align-items:center;gap:8px;padding:3.5px 0}
.au-row.off{opacity:.42}
.au-name{font-weight:600;font-size:12px;white-space:nowrap}
.au-desc{font-size:9.5px;color:#8d99b1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:400;margin-top:1px}
.au-track{position:relative;height:9px;border-radius:5px;background:rgba(255,255,255,.07);overflow:hidden}
.au-fill{position:absolute;inset:0;border-radius:5px;background:linear-gradient(90deg,#2fb8a0 0%,#54d99a 45%,#ffd166 78%,#ff6b6b 100%);clip-path:inset(0 100% 0 0);will-change:clip-path}
.au-peak{position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.85;left:0;will-change:left}
.au-db{font-variant-numeric:tabular-nums;text-align:right;color:#c9d2e3;font-size:11px}
.au-g{font-size:9.5px;color:#7f8ba3;display:flex;justify-content:space-between}.au-g i{font-style:normal;color:#9fb0cc}
.au-params{display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}
.au-p{display:flex;justify-content:space-between;font-size:11px}
.au-p b{color:#8d99b1;font-weight:500}.au-p span{font-variant-numeric:tabular-nums;color:#e9edf5}
.au-foot{display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:#9aa6bd}
.au-foot input[type=range]{flex:1;accent-color:#54d99a;height:14px}
.au-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#e9edf5;border-radius:8px;padding:3px 9px;font:inherit;font-size:11px;cursor:pointer}
.au-btn:hover{background:rgba(255,255,255,.15)}
.au-hint{margin-top:10px;padding:9px 10px;border-radius:10px;background:rgba(255,209,102,.12);border:1px solid rgba(255,209,102,.3);color:#ffd98a;font-size:12px;text-align:center}
`;

export function createPanel(root, api) {
  const el = document.createElement('div'); el.className = 'au-panel';
  const style = document.createElement('style'); style.textContent = CSS; el.appendChild(style);
  el.innerHTML += `
    <div class="au-h"><div class="au-dot"></div><div class="au-title">Ambience Engine</div><div class="au-sub">procedural WebAudio<br>0 draw calls · CC0 by construction</div></div>
    <canvas class="au-spec" width="336" height="58"></canvas>
    <div class="au-layers"></div>
    <div class="au-params"></div>
    <div class="au-foot"><span class="au-pill">SUSPENDED</span><input type="range" min="0" max="100" value="70"><span class="au-vol">70%</span><button class="au-btn au-mute">Mute</button></div>
    <div class="au-hint" hidden>Click anywhere to start audio</div>`;
  root.appendChild(el);
  const q = (s) => el.querySelector(s);
  const dot = q('.au-dot'), pill = q('.au-pill'), spec = q('.au-spec'), layersEl = q('.au-layers'), paramsEl = q('.au-params'), hint = q('.au-hint');
  const range = q('input[type=range]'), volTxt = q('.au-vol'), muteBtn = q('.au-mute');
  const g2 = spec.getContext('2d');
  range.addEventListener('input', () => api.setVolume(range.value / 100));
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); api.mute(!api.isMuted()); });
  const rows = new Map();
  const PARAMS = ['hour', 'weather', 'daylight', 'altitude', 'distance', 'lowpass', 'wind', 'population', 'vehicles', 'context', 'sampleRate', 'cpu'];
  const pEls = new Map();
  for (const k of PARAMS) { const d = document.createElement('div'); d.className = 'au-p'; d.innerHTML = `<b>${k}</b><span>–</span>`; paramsEl.appendChild(d); pEls.set(k, d.lastChild); }
  let lastText = 0;
  const dbToX = (db) => Math.max(0, Math.min(1, (db + 60) / 60));

  function update(a, now) {
    const running = a.running;
    dot.classList.toggle('on', running); pill.classList.toggle('on', running); pill.textContent = running ? 'RUNNING' : (a.contextState || 'off').toUpperCase();
    hint.hidden = running;
    // spectrum
    const W = spec.width, H = spec.height; g2.clearRect(0, 0, W, H);
    const bins = a.spectrum; if (bins && bins.length) {
      const bars = 48; const n = bins.length; const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const lo = Math.floor(Math.pow(n, i / bars)), hi = Math.max(lo + 1, Math.floor(Math.pow(n, (i + 1) / bars)));
        let m = 0; for (let j = lo; j < hi && j < n; j++) if (bins[j] > m) m = bins[j];
        const h = (m / 255) * (H - 6);
        const t = i / bars; g2.fillStyle = `hsl(${165 - t * 150},72%,${52 + t * 8}%)`;
        g2.globalAlpha = 0.9; g2.fillRect(i * bw + 1, H - 3 - h, bw - 2, h);
      }
      g2.globalAlpha = 1;
    }
    // layers
    for (const L of a.layers) {
      let r = rows.get(L.name);
      if (!r) {
        const row = document.createElement('div'); row.className = 'au-row';
        row.innerHTML = `<div><div class="au-name">${L.label}</div><div class="au-desc">${L.desc}</div></div><div><div class="au-track"><div class="au-fill"></div><div class="au-peak"></div></div><div class="au-g"></div></div><div class="au-db">–</div>`;
        layersEl.appendChild(row);
        r = { row, fill: row.querySelector('.au-fill'), peak: row.querySelector('.au-peak'), db: row.querySelector('.au-db'), g: row.querySelector('.au-g') };
        rows.set(L.name, r);
      }
      const x = dbToX(L.meterDb), px = dbToX(L.peakDb);
      r.fill.style.clipPath = `inset(0 ${(100 - x * 100).toFixed(1)}% 0 0)`;
      r.peak.style.left = `calc(${(px * 100).toFixed(1)}% - 1px)`;
      r.row.classList.toggle('off', L.active === false);
      if (now - lastText > 120) { r.db.textContent = L.meterDb > -90 ? `${L.meterDb.toFixed(1)} dB` : '−∞ dB'; r.g.innerHTML = `<span>gain ${L.gain.toFixed(2)}${L.note ? ' · ' + L.note : ''}</span><i>${L.events ? '×' + L.events + ' events' : ''}</i>`; }
    }
    if (now - lastText > 120) {
      lastText = now;
      const p = a.params;
      const hh = Math.floor(p.hour), mm = Math.floor((p.hour - hh) * 60);
      const set = (k, v) => { pEls.get(k).textContent = v; };
      set('hour', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
      set('weather', p.weather + (p.weatherDemo ? ' (demo)' : ''));
      set('daylight', `${Math.round(p.daylight * 100)}%`);
      set('altitude', `${p.altitude.toFixed(0)} m`);
      set('distance', `${p.distance.toFixed(0)} m`);
      set('lowpass', `${(p.lowpass / 1000).toFixed(1)} kHz`);
      set('wind', `${p.wind.toFixed(1)} m/s`);
      set('population', `${p.population}${p.demo ? ' (demo)' : ''}`);
      set('vehicles', `${p.vehicles}${p.demo ? ' (demo)' : ''}`);
      set('context', a.contextState || 'none');
      set('sampleRate', a.sampleRate ? `${a.sampleRate} Hz` : '–');
      set('cpu', `${a.cpuMs.toFixed(3)} ms · panel ${a.panelMs.toFixed(2)}`);
      const vol = Math.round(a.volume * 100); if (document.activeElement !== range) range.value = vol; volTxt.textContent = a.muted ? 'muted' : `${vol}%`;
      muteBtn.textContent = a.muted ? 'Unmute' : 'Mute';
    }
  }
  return { el, update, destroy() { el.remove(); } };
}
