// Piloto automático "modo show": una exhibición coreografiada sobre el Malecón.
// Trayectoria cerrada: recta este -> eses derrapando -> donuts -> trompo 360°
// -> pasada a fondo -> frenada -> giro en U derrapando -> lo mismo hacia el oeste.
// La geometría se define por longitud de arco, así que el recorrido siempre cierra.
//
// Expone el mismo estado que CarPhysics para que el render/efectos/sonido sean iguales.

import { CAR_SPEC } from './physics.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;

// type: 'line' (len) | 'arc' (R, ang con signo: + = izquierda) | 'spin' (len, vuelta del chasis)
function program() {
  const half = [
    { type: 'line', len: 70, v: 62, beta: 0, name: 'Acelerando' },
    { type: 'arc', R: 55, ang: 0.28, v: 30, beta: 0.42, name: 'Eses derrapando' },
    { type: 'arc', R: 55, ang: -0.56, v: 30, beta: -0.5 },
    { type: 'arc', R: 55, ang: 0.28, v: 30, beta: 0.42 },
    { type: 'line', len: 34, v: 11.5, beta: 0, name: 'Preparando donuts' },
    { type: 'arc', R: 4.6, ang: TAU * 3, v: 11.5, beta: 1.12, name: 'Donuts' },
    { type: 'line', len: 26, v: 16, beta: 0 },
    { type: 'spin', len: 30, v: 15, turns: 1, name: 'Trompo 360°' },
    { type: 'line', len: 185, v: 86, beta: 0, name: 'Pasada a fondo' },
    { type: 'line', len: 60, v: 13, beta: 0, name: 'Frenada' },
    { type: 'arc', R: 8, ang: Math.PI, v: 13, beta: 0.95, name: 'Giro en U derrapando' },
  ];
  return [...half, ...half.map(m => ({ ...m }))];
}

export class AutoPilot {
  constructor(startX = -232, laneZ = 8) {
    this.p = CAR_SPEC;
    this.prog = program();
    this.startX = startX; this.laneZ = laneZ;
    this.reset();
  }

  reset() {
    this.seg = 0; this.s = 0;
    this.px = this.startX; this.pz = this.laneZ; this.psi = Math.PI / 2; // velocidad hacia +X
    this.V = 20; this.beta = 0; this.betaVel = 0;
    Object.assign(this, {
      heading: this.psi, x: this.px, z: this.pz,
      u: this.V, v: 0, r: 0, steer: 0,
      wheelSpinF: 0, wheelSpinR: 0, wheelAngleF: 0, wheelAngleR: 0,
      rearSurface: this.V, slideF: 0, slideR: 0, accLong: 0, accLat: 0,
      throttle: 1, brake: 0, gear: 3, rpm: 9000, spinning: 0, label: '',
    });
  }

  get speed() { return this.V; }
  get slipAngle() { return this.beta; }

  _len(m) {
    return m.type === 'arc' ? Math.abs(m.ang) * m.R : m.len;
  }

  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 20);
    const prog = this.prog;
    let m = prog[this.seg];
    this.label = m.name || this.label;

    // --- velocidad: objetivo actual + frenada anticipada a los siguientes tramos ---
    let target = m.v;
    let dist = this._len(m) - this.s;
    for (let k = 1; k <= 4; k++) {
      const n = prog[(this.seg + k) % prog.length];
      target = Math.min(target, Math.sqrt(n.v * n.v + 2 * 30 * Math.max(0, dist - 4)));
      dist += this._len(n);
    }
    const aMax = Math.min(12.5, 680 / Math.max(this.V, 1));
    const prevV = this.V;
    if (target > this.V) this.V = Math.min(target, this.V + aMax * dt);
    else this.V = Math.max(target, this.V - 38 * dt);
    const accLong = (this.V - prevV) / dt;

    // --- avance por la trayectoria (consumiendo tramos) ---
    let ds = this.V * dt;
    let kappa = 0;
    while (ds > 0) {
      m = prog[this.seg];
      const L = this._len(m);
      const step = Math.min(ds, L - this.s);
      if (m.type === 'arc') {
        kappa = Math.sign(m.ang) / m.R;
        // avance exacto sobre el arco
        const dpsi = kappa * step;
        // centro del arco a la izquierda (s) para kappa>0
        const sx = Math.cos(this.psi), sz = -Math.sin(this.psi);
        const Rs = 1 / kappa;
        const cx = this.px + sx * Rs, cz = this.pz + sz * Rs;
        this.psi += dpsi;
        this.px = cx - Math.cos(this.psi) * Rs;
        this.pz = cz + Math.sin(this.psi) * Rs;
      } else {
        kappa = 0;
        this.px += Math.sin(this.psi) * step;
        this.pz += Math.cos(this.psi) * step;
      }
      this.s += step; ds -= step;
      if (this.s >= L - 1e-6) {
        this.s = 0;
        this.seg++;
        if (this.seg >= prog.length) {
          // cerrar el bucle exactamente (elimina el error numérico acumulado)
          this.seg = 0;
          this.px = this.startX; this.pz = this.laneZ; this.psi = Math.PI / 2;
        }
      }
    }
    m = prog[this.seg];

    // --- ángulo de deriva (resorte críticamente amortiguado) ---
    let betaTarget = m.beta || 0;
    if (m.type === 'spin') {
      // el chasis gira 360° mientras la velocidad sigue recta
      const t = this.s / m.len;
      const e = t * t * (3 - 2 * t);
      betaTarget = e * TAU * m.turns;
      this.beta = betaTarget; this.betaVel = 0;
    } else {
      if (this.beta > Math.PI) this.beta -= TAU; // tras el trompo
      const w = 4.2;
      const acc = w * w * (betaTarget - this.beta) - 2 * w * this.betaVel;
      this.betaVel += acc * dt;
      this.beta += this.betaVel * dt;
    }

    // --- estado expuesto ---
    const prevHeading = this.heading;
    this.heading = this.psi + this.beta;
    let dh = this.heading - prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.r = dh / dt;
    this.x = this.px; this.z = this.pz;
    this.u = this.V * Math.cos(this.beta);
    this.v = -this.V * Math.sin(this.beta);

    const lockMax = this.p.maxSteer;
    const sb = Math.atan2(Math.sin(this.beta), Math.cos(this.beta));
    let steer = -sb * 0.95 + kappa * 3.6;
    if (m.type === 'spin') steer = -Math.sign(Math.sin(this.beta)) * lockMax * 0.8;
    this.steer += (clamp(steer, -lockMax, lockMax) - this.steer) * Math.min(1, dt * 8);

    const drifting = clamp(Math.abs(Math.sin(sb)) * 1.6, 0, 1) * clamp(this.V / 6, 0, 1);
    this.accLong += (accLong - this.accLong) * Math.min(1, dt * 6);
    this.accLat += (this.V * this.V * kappa - this.accLat) * Math.min(1, dt * 6);
    this.throttle = accLong > 0.5 || drifting > 0.2 ? clamp(0.55 + drifting * 0.45 + accLong / 25, 0, 1) : 0;
    this.brake = accLong < -3 ? clamp(-accLong / 38, 0, 1) : 0;
    this.spinning = drifting;

    const R = this.p.wheelRadius;
    const rearTarget = this.V * Math.cos(sb) + drifting * (9 + this.V * 0.4);
    this.rearSurface += (rearTarget - this.rearSurface) * Math.min(1, dt * 6);
    this.wheelSpinF = this.u / R;
    this.wheelSpinR = this.rearSurface / R;
    this.wheelAngleF += this.wheelSpinF * dt;
    this.wheelAngleR += this.wheelSpinR * dt;
    this.slideR = drifting;
    this.slideF = clamp(drifting * 0.35 + (this.brake > 0.9 && this.V > 30 ? 0.25 : 0), 0, 1);

    // caja de cambios (misma lógica que la física)
    const p = this.p;
    const wheelKmh = Math.abs(this.rearSurface) * 3.6;
    let rpm = (wheelKmh / p.gearTops[this.gear - 1]) * p.maxRpm;
    if (rpm > 11700 && this.gear < 8) this.gear++;
    else if (this.gear > 1 && rpm < 7200 && wheelKmh < p.gearTops[this.gear - 2] * 0.92) this.gear--;
    rpm = (wheelKmh / p.gearTops[this.gear - 1]) * p.maxRpm;
    rpm = clamp(Math.max(rpm, 4000 + this.throttle * 3500), 4000, 12350);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 14);
  }
}
