// Sonido sintetizado con Web Audio: motor V6 turbo híbrido, chirrido de neumáticos,
// olas del Caribe y público. Incluye efecto Doppler y atenuación por distancia.

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // --- bus del coche (paneo + distancia) ---
    this.pan = ctx.createStereoPanner();
    this.carGain = ctx.createGain();
    this.carGain.connect(this.pan).connect(master);

    // --- motor: armónicos de la frecuencia de encendido ---
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 1.6;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.carGain);
    const mk = (type, gain) => {
      const o = ctx.createOscillator(); o.type = type;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g).connect(shaper); o.start();
      return o;
    };
    this.oscs = [
      { o: mk('sawtooth', 0.32), mul: 1 },
      { o: mk('square', 0.16), mul: 0.5 },
      { o: mk('sawtooth', 0.12), mul: 2 },
      { o: mk('triangle', 0.18), mul: 1.5 },
      { o: mk('sawtooth', 0.05), mul: 3.01 },
    ];
    // aspereza: modulación rápida de amplitud
    const lfo = ctx.createOscillator(); lfo.frequency.value = 31;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG).connect(this.engGain.gain); lfo.start();
    this.lfo = lfo;
    // silbido del turbo / MGU-H
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG).connect(this.carGain); this.turbo.start();

    // --- ruido base ---
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };

    // --- chirrido de neumáticos ---
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    this.squealF1 = ctx.createBiquadFilter(); this.squealF1.type = 'bandpass'; this.squealF1.Q.value = 9; this.squealF1.frequency.value = 1100;
    this.squealF2 = ctx.createBiquadFilter(); this.squealF2.type = 'bandpass'; this.squealF2.Q.value = 12; this.squealF2.frequency.value = 2300;
    const n1 = noise();
    n1.connect(this.squealF1).connect(this.squealG);
    n1.connect(this.squealF2).connect(this.squealG);
    this.squealG.connect(this.carGain);
    // rugosidad de rodadura
    this.roadF = ctx.createBiquadFilter(); this.roadF.type = 'lowpass'; this.roadF.frequency.value = 300;
    this.roadG = ctx.createGain(); this.roadG.gain.value = 0;
    noise().connect(this.roadF).connect(this.roadG).connect(this.carGain);

    // --- ambiente: olas + público ---
    const waveF = ctx.createBiquadFilter(); waveF.type = 'lowpass'; waveF.frequency.value = 420;
    this.waveG = ctx.createGain(); this.waveG.gain.value = 0.05;
    noise().connect(waveF).connect(this.waveG).connect(master);
    const crowdF = ctx.createBiquadFilter(); crowdF.type = 'bandpass'; crowdF.frequency.value = 700; crowdF.Q.value = 0.7;
    this.crowdG = ctx.createGain(); this.crowdG.gain.value = 0.012;
    noise().connect(crowdF).connect(this.crowdG).connect(master);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /**
   * @param st     estado del coche (rpm, throttle, slideR, slideF, speed)
   * @param rel    { dist, radialVel (m/s, + = se aleja), pan (-1..1), onboard }
   */
  update(st, rel, t) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const tc = 0.03;
    const doppler = rel.onboard ? 1 : 343 / (343 + Math.max(-150, Math.min(150, rel.radialVel)));
    const fire = (st.rpm / 60) * 3 * doppler; // V6 cuatro tiempos: 3 explosiones por vuelta
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(fire * mul, now, tc);
    this.lfo.frequency.setTargetAtTime(fire / 6, now, tc);
    this.engFilter.frequency.setTargetAtTime(500 + st.throttle * 3200 + (st.rpm / 12000) * 2200, now, tc);
    const eg = 0.06 + st.throttle * 0.22 + (st.rpm / 12000) * 0.06;
    this.engGain.gain.setTargetAtTime(eg, now, tc);
    this.turbo.frequency.setTargetAtTime((2400 + st.rpm * 0.42) * doppler, now, tc);
    this.turboG.gain.setTargetAtTime(st.throttle * (st.rpm / 12000) * 0.012, now, 0.08);

    const sl = Math.max(st.slideR, st.slideF * 0.8);
    const wob = 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.3);
    this.squealG.gain.setTargetAtTime(sl * sl * 0.5 * wob, now, 0.04);
    this.squealF1.frequency.setTargetAtTime((950 + sl * 450 + Math.sin(t * 13) * 60) * doppler, now, 0.05);
    this.squealF2.frequency.setTargetAtTime((2100 + sl * 600) * doppler, now, 0.05);
    this.roadG.gain.setTargetAtTime(Math.min(1, st.speed / 60) * 0.12, now, 0.1);

    const att = rel.onboard ? 0.55 : 1 / (1 + rel.dist / 14);
    this.carGain.gain.setTargetAtTime(att, now, 0.05);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, rel.pan)), now, 0.05);

    this.waveG.gain.setTargetAtTime(0.035 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.45)) * (0.6 + 0.4 * Math.sin(t * 0.13)), now, 0.3);
    this.crowdG.gain.setTargetAtTime(0.01 + rel.crowd * 0.05, now, 0.4);
  }
}
