import * as THREE from 'three';
export class Clock {
  constructor(events) {
    this.events = events;
    this.hour = 14;          // 0..24
    this.day = 1;
    this.speed = 60;         // game seconds per real second
    this.paused = false;
    this.elapsed = 0;        // real seconds since start
    this.sun = new THREE.Vector3(0.3, 0.8, 0.2).normalize(); // written by environment
    this._lastEmitHour = -1;
  }
  get dayFraction() { return this.hour / 24; }
  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    this._emit(true);
  }
  setSpeed(s) { this.speed = s; }
  tick(dt) {
    this.elapsed += dt;
    if (this.paused) return;
    this.hour += (dt * this.speed) / 3600;
    if (this.hour >= 24) { this.hour -= 24; this.day += 1; }
    this._emit(false);
  }
  _emit(force) {
    if (force || Math.abs(this.hour - this._lastEmitHour) > 1 / 60) {
      this._lastEmitHour = this.hour;
      this.events.emit('time:changed', { hour: this.hour, day: this.day, speed: this.speed });
    }
  }
  sunDirection(out = new THREE.Vector3()) { return out.copy(this.sun); }
}
