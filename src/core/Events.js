export class Events {
  constructor(log = console) { this._map = new Map(); this._log = log; }
  on(name, fn) {
    if (!this._map.has(name)) this._map.set(name, new Set());
    this._map.get(name).add(fn);
    return () => this.off(name, fn);
  }
  once(name, fn) { const off = this.on(name, (p) => { off(); fn(p); }); return off; }
  off(name, fn) { this._map.get(name)?.delete(fn); }
  emit(name, payload = {}) {
    const set = this._map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { this._log.error(`[events] handler for '${name}' threw`, e); }
    }
  }
  clear() { this._map.clear(); }
}
