// Dinámica de vehículo (modelo de bicicleta con neumáticos no lineales,
// círculo de fricción, carga aerodinámica y patinaje de las ruedas traseras).
// Módulo puro: no depende de three.js, así se puede probar en Node.
//
// Convenciones (plano XZ, Y hacia arriba):
//   heading h  -> vector adelante f = (sin h, cos h)
//   lateral s  -> (cos h, -sin h)  = izquierda del piloto
//   u = velocidad longitudinal, v = velocidad lateral (hacia s), r = dh/dt

const G = 9.81;

export const CAR_SPEC = {
  mass: 800,          // kg con piloto (reglamento ~798 kg)
  inertia: 1150,      // kg·m² en guiñada
  a: 1.62,            // CG -> eje delantero (m)
  b: 1.98,            // CG -> eje trasero (m)
  wheelRadius: 0.36,  // llantas de 18"
  mu: 1.65,           // slicks calientes
  downforce: 3.1,     // N por (m/s)²  (~21 kN a 300 km/h)
  frontAero: 0.44,
  drag: 0.9,          // 0.5·ρ·Cd·A
  roll: 180,          // resistencia a la rodadura (N)
  power: 620000,      // W efectivos en rueda (V6 turbo híbrido)
  maxSteer: 0.40,     // rad en las ruedas (~23°)
  gearTops: [86, 124, 158, 192, 226, 262, 298, 345], // km/h a 12 000 rpm
  maxRpm: 12000,
};

function tireForce(alpha, cap) {
  // Curva tipo Pacejka simplificada: pico ~8° y caída a ~76 % en derrape total
  return cap * Math.sin(1.45 * Math.atan(11 * alpha));
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class CarPhysics {
  constructor(spec = CAR_SPEC) {
    this.p = spec;
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    Object.assign(this, {
      x, z, heading,
      u: 0, v: 0, r: 0,
      steer: 0,
      wheelSpinF: 0, wheelSpinR: 0,    // rad/s
      wheelAngleF: 0, wheelAngleR: 0,  // rad (para animar)
      rearSurface: 0,                  // velocidad de superficie de la rueda trasera
      slideF: 0, slideR: 0,            // 0..1 intensidad de deslizamiento
      accLong: 0, accLat: 0,
      throttle: 0, brake: 0,
      gear: 1, rpm: 4000, spinning: 0,
    });
  }

  get speed() { return Math.hypot(this.u, this.v); }
  /** ángulo de deriva (velocidad vs. morro), positivo = morro hacia dentro a la izquierda */
  get slipAngle() { return this.speed < 1 ? 0 : Math.atan2(-this.v, Math.abs(this.u)); }

  update(dt, input) {
    if (!(dt > 0)) return;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h, input);
    this._gearbox(dt);
  }

  _step(dt, input) {
    const p = this.p;
    const L = p.a + p.b;
    const throttle = clamp(input.throttle || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);
    const hand = !!input.handbrake;
    this.throttle = throttle; this.brake = brake;

    // Dirección: velocidad de giro limitada y menos ángulo a alta velocidad
    const spd = this.speed;
    const lock = p.maxSteer * (1 / (1 + Math.max(0, spd - 12) * 0.035));
    let target = clamp(input.steer || 0, -1, 1) * lock;
    // "ayuda de contravolante": si se suelta el volante en derrape, las ruedas siguen la trayectoria
    if (input.assist && Math.abs(input.steer || 0) < 0.05 && spd > 4) {
      target = clamp(-this.slipAngle * 0.8, -p.maxSteer, p.maxSteer);
    }
    const rate = 3.2 * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    const d = this.steer;

    // Cargas verticales (estáticas + aerodinámicas + transferencia longitudinal)
    const df = p.downforce * this.u * this.u;
    const W = p.mass * G;
    const transfer = clamp(this.accLong, -45, 20) * p.mass * 0.32 / L; // altura CG ≈ 0.32 m
    const Fzf = Math.max(500, W * p.b / L + df * p.frontAero - transfer);
    const Fzr = Math.max(500, W * p.a / L + df * (1 - p.frontAero) + transfer);
    const capF0 = p.mu * Fzf, capR0 = p.mu * 1.06 * Fzr; // trasera algo más ancha: subviraje leve

    const uAbs = Math.abs(this.u);
    const uDen = Math.max(uAbs, 3);
    const dir = this.u >= 0 ? 1 : -1;

    // --- Eje trasero: tracción, frenada y patinaje (modelo de vector de deslizamiento) ---
    const vr = this.v - p.b * this.r;          // velocidad lateral del eje trasero
    let FxR = 0, FyR = 0, FxF = 0, spinTarget = this.u;
    let drive = 0;
    if (throttle > 0) drive = throttle * Math.min(13500, p.power / Math.max(uAbs, 4));
    if (brake > 0 && uAbs < 0.6 && throttle === 0) drive = -3200 * brake; // marcha atrás
    let fb = 0;
    if (brake > 0 && !(uAbs < 0.6 && throttle === 0)) {
      fb = brake * (capF0 + capR0) * 0.93;
      FxF -= dir * fb * 0.58;
    }
    const brakeR = fb * 0.42;
    const alphaR = Math.atan2(vr, uDen);
    const latDemand = Math.abs(tireForce(alphaR, capR0));
    const lonDemand = Math.abs(drive) + brakeR;
    const usage = Math.hypot(latDemand, lonDemand) / capR0;
    // ¿Las traseras rompen tracción? (más gas del que admite el círculo de fricción)
    // (con histéresis: cuesta más romper tracción que mantener el patinaje)
    const thr = (this.spinning > 0.5 ? 0.92 : 1.12) * Math.sqrt(Math.max(0.3, 1 - (latDemand / capR0) ** 2));
    const wantSpin = !hand && drive > capR0 * thr;
    if (hand) spinTarget = 0;
    else if (wantSpin) spinTarget = this.u + (4.5 + 11 * throttle * clamp((drive / capR0) - 0.5, 0, 1));
    this.rearSurface += (spinTarget - this.rearSurface) * Math.min(1, dt * (hand ? 30 : wantSpin ? 6 : 10));
    const slipX = this.rearSurface - this.u;
    const sliding = hand || Math.abs(slipX) > 1.0;
    let spinning = 0;
    if (sliding) {
      // Fricción cinética opuesta al deslizamiento del parche de contacto
      const mag = Math.hypot(slipX, vr);
      const fk = p.mu * 0.86 * Fzr * clamp(mag / 1.5, 0, 1);
      const k = mag > 1e-4 ? fk / mag : 0;
      // mezcla suave con el régimen de agarre para evitar saltos
      const blend = hand ? 1 : clamp((Math.abs(slipX) - 1) / 2, 0, 1);
      const gripFx = clamp(drive - dir * brakeR, -capR0, capR0);
      const gripFy = -tireForce(alphaR, Math.sqrt(Math.max(0, capR0 * capR0 - gripFx * gripFx)));
      FxR = gripFx * (1 - blend) + slipX * k * blend;
      FyR = gripFy * (1 - blend) + (-vr * k) * blend;
      spinning = blend;
    } else {
      FxR = clamp(drive - dir * brakeR, -capR0, capR0);
      FyR = -tireForce(alphaR, Math.sqrt(Math.max(0, capR0 * capR0 - FxR * FxR)));
    }
    void usage;

    // --- Eje delantero ---
    const capF = Math.sqrt(Math.max(0, capF0 * capF0 - FxF * FxF));
    const alphaF = Math.atan2(this.v + p.a * this.r, uDen) - d * dir;
    const FyF = -tireForce(alphaF, capF);

    const drag = p.drag * this.u * Math.abs(this.u) + (uAbs > 0.1 ? dir * p.roll : 0);
    const Fx = FxR + FxF * Math.cos(d) - FyF * Math.sin(d) - drag;
    const Fy = FyR + FyF * Math.cos(d) + FxF * Math.sin(d);

    let du = Fx / p.mass + this.v * this.r;
    let dv = Fy / p.mass - this.u * this.r;
    let dr = (p.a * (FyF * Math.cos(d) + FxF * Math.sin(d)) - p.b * FyR) / p.inertia;

    // Asistente de derrape: evita el trompo a velocidad (permite trompos/donuts a baja velocidad)
    if (input.assist && spd > 9) {
      const beta = Math.atan2(-this.v, Math.max(uAbs, 0.5));
      const bMax = 0.62;
      const ex = Math.abs(beta) - bMax;
      const sgn = Math.sign(beta);
      if (ex > 0) dr -= sgn * (ex * 30 + Math.max(0, this.r * sgn) * 6);
      else if (Math.abs(beta) > 0.2) dr -= this.r * sgn * Math.max(0, this.r * sgn) * 0.6;
    }

    this.accLong = this.accLong + (Fx / p.mass - this.accLong) * Math.min(1, dt * 12);
    this.accLat = this.accLat + (Fy / p.mass - this.accLat) * Math.min(1, dt * 12);

    this.u += du * dt;
    this.v += dv * dt;
    this.r += dr * dt;

    // Parado: amortigua el ruido numérico
    if (uAbs < 1.2 && throttle === 0) {
      const k = Math.exp(-dt * 6);
      this.v *= k; this.r *= k;
      if (uAbs < 0.15 && brake === 0) this.u *= k;
    }
    // Evita que el frenado invierta la marcha
    if (brake > 0 && throttle === 0 && Math.sign(this.u) !== dir && uAbs > 0.6) this.u = 0;

    this.heading += this.r * dt;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    this.x += (this.u * sh + this.v * ch) * dt;
    this.z += (this.u * ch - this.v * sh) * dt;

    // Ruedas
    const R = p.wheelRadius;
    this.wheelSpinF = this.u / R;
    this.wheelSpinR = this.rearSurface / R;
    this.wheelAngleF += this.wheelSpinF * dt;
    this.wheelAngleR += this.wheelSpinR * dt;
    this.spinning = spinning;

    // Intensidad de deslizamiento para humo y marcas
    const latR = Math.abs(vr);
    const lonR = Math.abs(this.rearSurface - this.u);
    const slipR = Math.hypot(latR, lonR);
    const vfLat = (this.v + p.a * this.r) * Math.cos(d) - this.u * Math.sin(d);
    const slipF = Math.abs(vfLat) + (brake > 0.85 && uAbs > 25 ? 3 : 0);
    this.slideR = clamp((slipR - 2.2) / 7, 0, 1);
    this.slideF = clamp((slipF - 3.0) / 8, 0, 1);
    this.alphaF = alphaF; this.alphaR = alphaR;
  }

  _gearbox(dt) {
    const p = this.p;
    const wheelKmh = Math.abs(this.rearSurface) * 3.6;
    const top = p.gearTops[this.gear - 1];
    let rpm = (wheelKmh / top) * p.maxRpm;
    if (rpm > 11700 && this.gear < 8) this.gear++;
    else if (this.gear > 1 && rpm < 7200 && wheelKmh < p.gearTops[this.gear - 2] * 0.92) this.gear--;
    rpm = (wheelKmh / p.gearTops[this.gear - 1]) * p.maxRpm;
    const idle = 4000 + this.throttle * 3500;
    rpm = clamp(Math.max(rpm, idle), 4000, 12350);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 14);
  }
}
