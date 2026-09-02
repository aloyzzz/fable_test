// Fails if Math.random is used anywhere under src/. Determinism rule (ARCHITECTURE.md §7).
import fs from 'node:fs'; import path from 'node:path';
let bad = [];
function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(f)) { const s = fs.readFileSync(p, 'utf8'); s.split('\n').forEach((l, i) => { if (/Math\.random\s*\(/.test(l)) bad.push(`${p}:${i + 1}: ${l.trim()}`); }); } } }
walk('src');
if (bad.length) { console.error('Math.random is forbidden in src/ (use ctx.rng.fork):\n' + bad.join('\n')); process.exit(1); }
console.log('check-rng: OK');
