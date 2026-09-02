// Record a critic result into docs/STATUS.json.
// node tools/status.mjs --module=roads --round=1 --score=7.4 --pass=false --errors=0 --drawCalls=88 --issues="1. ...|2. ..." --shots="a.png,b.png"
// node tools/status.mjs --game --round=1 --score=... ; node tools/status.mjs --wave=1 ; node tools/status.mjs --show
import fs from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const P = 'docs/STATUS.json';
const s = JSON.parse(fs.readFileSync(P, 'utf8'));
if (args.show) {
  const rows = Object.entries(s.modules).map(([k, v]) => `${k.padEnd(12)} wave${v.wave} r${v.round} score=${v.score ?? '-'} ${v.pass ? 'PASS' : 'open'} issues=${v.issues.length}`);
  console.log(rows.join('\n')); console.log(`game r${s.game.round} score=${s.game.score ?? '-'} ${s.game.pass ? 'PASS' : 'open'}`);
  const weakest = Object.entries(s.modules).filter(([, v]) => !v.pass).sort((a, b) => (a[1].score ?? -1) - (b[1].score ?? -1))[0];
  console.log('weakest:', weakest ? weakest[0] : 'none'); process.exit(0);
}
if (args.wave) s.wave = Number(args.wave);
const target = args.game ? s.game : args.module ? s.modules[args.module] : null;
if (target) {
  if (args.round) target.round = Number(args.round);
  if (args.score != null) target.score = Number(args.score);
  if (args.pass != null) target.pass = String(args.pass) === 'true';
  if (args.errors != null) target.errors = Number(args.errors);
  if (args.drawCalls != null) target.drawCalls = Number(args.drawCalls);
  if (args.issues != null) target.issues = String(args.issues).split('|').map((x) => x.trim()).filter(Boolean);
  if (args.shots != null) target.screenshots = String(args.shots).split(',').map((x) => x.trim()).filter(Boolean);
  target.updated = new Date().toISOString();
  s.history.push({ at: target.updated, module: args.game ? 'game' : args.module, round: target.round, score: target.score, pass: target.pass, issues: target.issues?.length ?? 0 });
}
s.updated = new Date().toISOString();
fs.writeFileSync(P, JSON.stringify(s, null, 2) + '\n');
console.log('STATUS.json updated');
