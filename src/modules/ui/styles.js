// HUD stylesheet, injected as a <style> element by index.js. Dark glass, restrained.
export const CSS = `
#ui > #hud { pointer-events: none; }
#hud {
  --ui-bg: rgba(14,18,26,0.72);
  --ui-bg-solid: rgba(14,18,26,0.92);
  --ui-hover: rgba(255,255,255,0.07);
  --ui-border: rgba(255,255,255,0.08);
  --ui-border-strong: rgba(255,255,255,0.16);
  --ui-fg: #e9edf4;
  --ui-dim: rgba(233,237,244,0.62);
  --ui-faint: rgba(233,237,244,0.36);
  --ui-accent: #5ab0ff;
  --ui-accent-bg: rgba(90,176,255,0.16);
  --ui-accent-border: rgba(90,176,255,0.5);
  --ui-green: #5fd08a; --ui-red: #ff6b6b; --ui-amber: #f2b544; --ui-blue: #57a8ff; --ui-orange: #ff9f43; --ui-purple: #a98bff;
  --ui-radius: 10px;
  --ui-shadow: 0 8px 28px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05);
  position: absolute; inset: 0; overflow: hidden;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--ui-fg); -webkit-font-smoothing: antialiased; user-select: none;
  font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
}
#hud * { box-sizing: border-box; }
#hud .panel {
  pointer-events: auto; position: absolute;
  background: var(--ui-bg); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius); box-shadow: var(--ui-shadow);
}
#hud .ico { display: block; flex: none; }
#hud .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 9px;
  border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--ui-dim); cursor: pointer;
  font: inherit; line-height: 1; white-space: nowrap; outline: none;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease, box-shadow .15s ease;
}
#hud .btn:hover { background: var(--ui-hover); color: var(--ui-fg); }
#hud .btn:active { background: rgba(255,255,255,0.11); }
#hud .btn.active { background: var(--ui-accent-bg); color: #fff; border-color: var(--ui-accent-border); box-shadow: inset 0 0 0 1px rgba(90,176,255,0.12), 0 0 14px rgba(90,176,255,0.14); }
#hud .btn.icon { width: 28px; padding: 0; }
#hud .btn.danger.active { background: rgba(255,107,107,0.16); border-color: rgba(255,107,107,0.5); box-shadow: 0 0 14px rgba(255,107,107,0.14); }
#hud .sep { width: 1px; height: 22px; background: var(--ui-border-strong); margin: 0 6px; flex: none; }
#hud .grow { flex: 1 1 auto; }
#hud .kbd { display: inline-block; min-width: 16px; padding: 1px 4px; border-radius: 4px; font-size: 10px; line-height: 12px; text-align: center; color: var(--ui-faint); background: rgba(255,255,255,0.05); border: 1px solid var(--ui-border); }

/* ---------- top bar ---------- */
#hud .topbar { top: 12px; left: 12px; right: 12px; height: 46px; display: flex; align-items: center; padding: 0 8px 0 10px; gap: 2px; }
#hud .cityname { display: flex; align-items: center; gap: 8px; color: var(--ui-fg); }
#hud .cityname .ico { color: var(--ui-accent); }
#hud .cityname input {
  font: inherit; font-weight: 600; font-size: 14px; letter-spacing: .01em; color: var(--ui-fg); background: transparent; border: 1px solid transparent;
  border-radius: 6px; padding: 4px 7px; width: 168px; outline: none; transition: background-color .15s, border-color .15s;
}
#hud .cityname input:hover { background: var(--ui-hover); }
#hud .cityname input:focus { background: rgba(0,0,0,0.25); border-color: var(--ui-accent-border); }
#hud .stat { display: flex; align-items: center; gap: 7px; padding: 0 8px; height: 32px; border-radius: 7px; }
#hud .stat .ico { color: var(--ui-dim); }
#hud .stat .v { font-weight: 600; font-size: 14px; letter-spacing: .01em; }
#hud .stat .sub { font-size: 11px; color: var(--ui-faint); margin-left: 2px; transition: color .3s; }
#hud .stat.money .v { min-width: 104px; transition: color .25s; }
#hud .stat.money.up .v, #hud .stat.money.up .sub { color: var(--ui-green); }
#hud .stat.money.down .v, #hud .stat.money.down .sub { color: var(--ui-red); }
#hud .stat.pop .v { min-width: 56px; }
#hud .datetime { display: flex; align-items: center; gap: 12px; padding: 0 6px; }
#hud .datetime .d { display: flex; align-items: center; gap: 6px; color: var(--ui-dim); }
#hud .datetime .t { font-weight: 600; font-size: 15px; min-width: 44px; }
#hud .seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; background: rgba(0,0,0,0.22); border: 1px solid var(--ui-border); border-radius: 8px; }
#hud .seg .btn { height: 24px; padding: 0 7px; border-radius: 6px; font-size: 12px; font-weight: 600; }
#hud .seg .btn.icon { width: 26px; }
#hud .seg .btn.active { box-shadow: none; }
#hud .tod { display: flex; align-items: center; gap: 8px; padding: 0 4px; }
#hud .tod .ico { color: var(--ui-amber); transition: color .3s; }
#hud .tod.night .ico { color: #b7c6ff; }
#hud .tod .hr { font-size: 11px; color: var(--ui-faint); min-width: 34px; text-align: right; }
#hud input[type=range].slider { -webkit-appearance: none; appearance: none; width: 128px; height: 16px; background: transparent; margin: 0; cursor: pointer; }
#hud input[type=range].slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, #1b2a5a 0%, #f2b544 26%, #8ec6ff 50%, #f28f44 75%, #1b2a5a 100%); opacity: .9; }
#hud input[type=range].slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: #fff; border: 2px solid rgba(14,18,26,0.9); box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 2px 6px rgba(0,0,0,0.4); }
#hud input[type=range].slider::-moz-range-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, #1b2a5a 0%, #f2b544 26%, #8ec6ff 50%, #f28f44 75%, #1b2a5a 100%); }
#hud input[type=range].slider::-moz-range-thumb { width: 10px; height: 10px; border-radius: 50%; background: #fff; border: 2px solid rgba(14,18,26,0.9); }
#hud .weather { min-width: 104px; justify-content: flex-start; }
#hud .weather .ico { color: var(--ui-amber); }
#hud .weather.overcast .ico, #hud .weather.fog .ico { color: #c9d3e6; }
#hud .weather.rain .ico { color: #8ec6ff; }
#hud .statusdot { position: relative; width: 28px; height: 28px; display: none; align-items: center; justify-content: center; color: var(--ui-red); }
#hud .statusdot.on { display: inline-flex; }
#hud .statusdot i { width: 9px; height: 9px; border-radius: 50%; background: var(--ui-red); box-shadow: 0 0 0 3px rgba(255,107,107,0.22), 0 0 10px rgba(255,107,107,0.6); animation: hud-pulse 1.6s ease-in-out infinite; }
@keyframes hud-pulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(.8); opacity: .7 } }

/* ---------- side widgets ---------- */
#hud .card-title { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ui-faint); margin-bottom: 8px; }
#hud .stats { top: 70px; left: 12px; width: 224px; padding: 10px 12px 8px; }
#hud .row { display: flex; align-items: center; gap: 8px; height: 26px; }
#hud .row .ico { color: var(--ui-dim); }
#hud .row .l { color: var(--ui-dim); flex: 1; }
#hud .row .v { font-weight: 600; min-width: 36px; text-align: right; }
#hud .row.happy .ico { color: var(--ui-green); }
#hud .row.happy.meh .ico { color: var(--ui-amber); }
#hud .row.happy.sad .ico { color: var(--ui-red); }
#hud .stepper { display: inline-flex; gap: 2px; margin-left: 4px; }
#hud .stepper .btn.icon { width: 20px; height: 20px; border-radius: 5px; color: var(--ui-faint); }
#hud .stepper .btn.icon:hover { color: var(--ui-fg); }
#hud .minibar { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.08); margin: 2px 0 6px 24px; overflow: hidden; }
#hud .minibar i { display: block; height: 100%; width: 50%; border-radius: 2px; background: var(--ui-green); transition: width .5s ease, background-color .3s; }

#hud .rci { bottom: 16px; left: 16px; padding: 10px 12px 8px; }
#hud .rci .bars { display: flex; gap: 10px; align-items: flex-end; }
#hud .rci .col { display: flex; flex-direction: column; align-items: center; gap: 5px; }
#hud .rci .bar { width: 18px; height: 68px; border-radius: 5px; background: rgba(255,255,255,0.06); border: 1px solid var(--ui-border); position: relative; overflow: hidden; }
#hud .rci .bar i { position: absolute; left: 0; right: 0; bottom: 0; height: 0%; border-radius: 4px 4px 0 0; transition: height .6s cubic-bezier(.2,.7,.2,1); }
#hud .rci .bar i::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 40%); }
#hud .rci .bar.res i { background: var(--ui-green); box-shadow: 0 0 10px rgba(95,208,138,0.35); }
#hud .rci .bar.com i { background: var(--ui-blue); box-shadow: 0 0 10px rgba(87,168,255,0.35); }
#hud .rci .bar.ind i { background: var(--ui-orange); box-shadow: 0 0 10px rgba(255,159,67,0.35); }
#hud .rci .lbl { font-size: 11px; font-weight: 700; }
#hud .rci .col.res .lbl { color: var(--ui-green); } #hud .rci .col.com .lbl { color: var(--ui-blue); } #hud .rci .col.ind .lbl { color: var(--ui-orange); }
#hud .rci .pct { font-size: 10px; color: var(--ui-faint); }

#hud .toasts { position: absolute; top: 70px; right: 12px; width: 300px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
#hud .toast { position: relative; pointer-events: auto; display: flex; align-items: flex-start; gap: 9px; padding: 9px 10px 9px 12px; overflow: hidden; animation: hud-toast-in .25s cubic-bezier(.2,.7,.2,1); }
#hud .toast::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--ui-accent); }
#hud .toast .ico { color: var(--ui-accent); margin-top: 1px; }
#hud .toast.success::before { background: var(--ui-green); } #hud .toast.success .ico { color: var(--ui-green); }
#hud .toast.warn::before { background: var(--ui-amber); } #hud .toast.warn .ico { color: var(--ui-amber); }
#hud .toast.error::before { background: var(--ui-red); } #hud .toast.error .ico { color: var(--ui-red); }
#hud .toast .txt { flex: 1; line-height: 1.35; color: var(--ui-fg); }
#hud .toast .btn.icon { width: 22px; height: 22px; margin: -3px -4px -3px 0; color: var(--ui-faint); }
#hud .toast.out { animation: hud-toast-out .2s ease forwards; }
@keyframes hud-toast-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes hud-toast-out { to { opacity: 0; transform: translateX(24px); } }

#hud .perf { bottom: 16px; right: 16px; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; display: none; min-width: 148px; }
#hud .perf.on { display: block; }
#hud .perf .row { height: 18px; gap: 6px; }
#hud .perf .row .ico { color: var(--ui-green); }
#hud .perf .v { min-width: 52px; text-align: right; }

/* ---------- info card / hint ---------- */
#hud .infocard { right: 16px; top: 50%; transform: translateY(-50%); width: 280px; display: none; }
#hud .infocard.on { display: block; }
#hud .infocard.at { top: auto; transform: none; }
#hud .infocard .hd { display: flex; align-items: center; gap: 10px; padding: 10px 8px 10px 12px; border-bottom: 1px solid var(--ui-border); }
#hud .infocard .chip { width: 10px; height: 26px; border-radius: 3px; background: var(--ui-accent); flex: none; }
#hud .infocard .ttl { flex: 1; min-width: 0; }
#hud .infocard .ttl b { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#hud .infocard .ttl span { display: block; font-size: 11px; color: var(--ui-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#hud .infocard .bd { padding: 6px 12px 8px; }
#hud .infocard .row { height: 24px; }
#hud .infocard .row .v { max-width: 64%; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#hud .hint { position: absolute; left: 0; top: 0; pointer-events: none; display: none; padding: 4px 9px; border-radius: 6px; background: var(--ui-bg-solid); border: 1px solid var(--ui-border-strong); box-shadow: 0 4px 14px rgba(0,0,0,0.35); font-size: 12px; font-weight: 600; white-space: nowrap; will-change: transform; }
#hud .hint.on { display: block; }

/* ---------- bottom toolbar ---------- */
#hud .toolbar { bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; padding: 6px; }
#hud .cat { width: 66px; height: 54px; flex-direction: column; gap: 4px; font-size: 11px; padding: 0; }
#hud .cat .ico { width: 20px; height: 20px; }
#hud .subpanel { bottom: 86px; left: 50%; transform: translateX(-50%); padding: 8px; display: none; }
#hud .subpanel.on { display: block; animation: hud-rise .18s cubic-bezier(.2,.7,.2,1); }
@keyframes hud-rise { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
#hud .subpanel .hd { display: flex; align-items: center; gap: 8px; padding: 2px 4px 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ui-faint); }
#hud .subpanel .opts { display: flex; gap: 4px; }
#hud .opt { width: 96px; height: 70px; flex-direction: column; gap: 3px; padding: 6px 4px 4px; font-size: 12px; }
#hud .opt .ico { width: 22px; height: 22px; margin-bottom: 1px; }
#hud .opt .sub { font-size: 10px; color: var(--ui-faint); line-height: 1; }
#hud .opt.active .sub { color: rgba(255,255,255,0.7); }
#hud .opt .cost { font-size: 10.5px; color: var(--ui-faint); line-height: 1; }
#hud .opt.active .cost { color: rgba(255,255,255,0.7); }
#hud .opt .zchip { width: 22px; height: 22px; border-radius: 6px; margin-bottom: 2px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.35); }
#hud .opt.active .zchip { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5), 0 0 12px currentColor; }

/* ---------- settings popover ---------- */
#hud .settings { top: 66px; right: 12px; width: 272px; padding: 10px 12px 12px; display: none; }
#hud .settings.on { display: block; animation: hud-drop .18s cubic-bezier(.2,.7,.2,1); }
@keyframes hud-drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
#hud .settings .card-title .btn.icon { width: 22px; height: 22px; margin: -4px -6px -4px 0; }
#hud .settings .row { height: 30px; }
#hud .settings .row .v { color: var(--ui-dim); font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
#hud .settings .seg .btn { padding: 0 10px; }
#hud .settings .sect { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ui-faint); margin: 8px 0 2px; }
#hud .toggle { width: 34px; height: 18px; border-radius: 9px; background: rgba(255,255,255,0.12); border: 1px solid var(--ui-border); position: relative; cursor: pointer; transition: background-color .15s; flex: none; }
#hud .toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; opacity: .8; transition: transform .15s ease, opacity .15s; }
#hud .toggle.on { background: var(--ui-accent); border-color: transparent; }
#hud .toggle.on::after { transform: translateX(16px); opacity: 1; }
#hud .settings .hintline { margin-top: 8px; font-size: 11px; color: var(--ui-faint); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
`;
