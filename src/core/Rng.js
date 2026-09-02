// Seeded RNG (sfc32). The only permitted source of randomness in src/.
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class Rng {
  constructor(seed, name = 'root') {
    this.seed = seed >>> 0;
    this.name = name;
    let a = 0x9e3779b9 ^ this.seed, b = hashString(name) ^ 0x243f6a88, c = this.seed * 0x85ebca6b, d = 0xc2b2ae35 ^ hashString(name + '#');
    this._s = new Uint32Array([a >>> 0, b >>> 0, c >>> 0, d >>> 0]);
    for (let i = 0; i < 12; i++) this.next();
  }
  next() {
    const s = this._s;
    const t = ((s[0] + s[1]) >>> 0) + s[3] >>> 0;
    s[3] = (s[3] + 1) >>> 0;
    s[0] = s[1] ^ (s[1] >>> 9);
    s[1] = (s[2] + (s[2] << 3)) >>> 0;
    s[2] = ((s[2] << 21) | (s[2] >>> 11)) >>> 0;
    s[2] = (s[2] + t) >>> 0;
    return (t >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  gaussian(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  fork(name) { return new Rng(this.seed ^ hashString(this.name + '/' + name), this.name + '/' + name); }
  // Deterministic hash → [0,1) for spatial noise without state.
  static hash2(x, y, seed = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647 >>> 3);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
}
export { hashString };
