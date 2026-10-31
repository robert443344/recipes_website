import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, ROAD, PRESETS } from './world.js';
import { F1Car } from './car.js';
import { CarPhysics } from './physics.js';
import { AutoPilot } from './autopilot.js';
import { TireSmoke, SkidMarks } from './effects.js';
import { CarAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- render
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 22000);
camera.position.set(-250, 4, 20);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 3; controls.maxDistance = 220;

// ---------------------------------------------------------------- mundo (se construye tras pintar la pantalla de carga)
let world, car, auto, phys, smoke, skids;
const audio = new CarAudio();
const contacts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

let mode = params.get('modo') === 'manual' ? 'manual' : 'auto';
const CAMS = ['Persecución', 'TV', 'Helicóptero', 'A bordo', 'Libre'];
const plain = (x) => x.normalize('NFD').replace(/[\u0300-\u036f\s]/g, '').toLowerCase();
let camIdx = Math.max(0, CAMS.findIndex(c => plain(c).startsWith(plain(params.get('cam') || 'tv'))));
const PRESET_KEYS = Object.keys(PRESETS);

function build() {
  world = new World(scene, renderer, { mobile });
  car = new F1Car();
  scene.add(car.group);
  auto = new AutoPilot();
  phys = new CarPhysics();
  phys.reset(-150, 8, Math.PI / 2);
  smoke = new TireSmoke(scene, mobile ? 1400 : 2600);
  skids = new SkidMarks(scene);
  const h = params.get('hora');
  if (h && PRESETS[h]) setPreset(h); else setPreset('atardecer');
  setMode(mode);
  setCam(camIdx);
  const warm = Number(params.get('t') || 0);
  for (let i = 0; i < warm * 30; i++) step(1 / 30, true);
}

// ---------------------------------------------------------------- entrada
const keys = new Set();
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyC': setCam((camIdx + 1) % CAMS.length); break;
    case 'KeyT': cyclePreset(); break;
    case 'KeyM': toggleSound(); break;
    case 'Digit1': case 'Tab': setMode(mode === 'auto' ? 'manual' : 'auto'); break;
    case 'KeyR': resetCar(); break;
    case 'KeyH': $('help').classList.toggle('hidden'); break;
    case 'KeyB': skids.clear(); break;
  }
  if (mode === 'auto' && ['KeyW', 'ArrowUp', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) setMode('manual');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, assist: true };
function readInput(dt) {
  const k = (...c) => c.some(x => keys.has(x));
  const tgtT = k('KeyW', 'ArrowUp') ? 1 : 0;
  const tgtB = k('KeyS', 'ArrowDown') ? 1 : 0;
  const tgtS = (k('KeyA', 'ArrowLeft') ? 1 : 0) - (k('KeyD', 'ArrowRight') ? 1 : 0);
  input.throttle += Math.sign(tgtT - input.throttle) * Math.min(Math.abs(tgtT - input.throttle), dt * 7);
  input.brake += Math.sign(tgtB - input.brake) * Math.min(Math.abs(tgtB - input.brake), dt * 9);
  const sRate = tgtS === 0 || Math.sign(tgtS) !== Math.sign(input.steer) ? 7 : 3.2;
  input.steer += Math.sign(tgtS - input.steer) * Math.min(Math.abs(tgtS - input.steer), dt * sRate);
  input.handbrake = k('Space');
}

// ---------------------------------------------------------------- UI
function setMode(m) {
  mode = m;
  if (m === 'manual') {
    // continuidad: el coche manual arranca donde estaba el del show
    const s = auto;
    phys.reset(s.x, s.z, s.heading);
    phys.u = s.u; phys.v = s.v; phys.r = s.r; phys.rearSurface = s.u; phys.gear = s.gear;
    phys.wheelAngleF = s.wheelAngleF; phys.wheelAngleR = s.wheelAngleR;
  } else {
    auto.reset();
  }
  $('btnMode').textContent = m === 'auto' ? 'Modo: Show automático' : 'Modo: Manual';
  $('label').style.opacity = m === 'auto' ? 1 : 0;
  document.body.classList.toggle('manual', m === 'manual');
}
function setCam(i) {
  camIdx = i;
  controls.enabled = CAMS[i] === 'Libre';
  if (controls.enabled && car) {
    controls.target.copy(car.group.position).add(new THREE.Vector3(0, 0.8, 0));
    camera.position.copy(car.group.position).add(new THREE.Vector3(-7, 3.5, 6));
    lastCarPos.copy(car.group.position);
  }
  tv.timer = 0;
  $('btnCam').textContent = 'Cámara: ' + CAMS[i];
}
function setPreset(name) {
  world.setPreset(name);
  bloom.strength = PRESETS[name].bloom ?? 0.32;
  smoke.setColors(PRESETS[name].smoke, name === 'noche' ? 0.6 : 0.55);
  $('btnTime').textContent = 'Hora: ' + PRESETS[name].label;
}
function cyclePreset() {
  const i = PRESET_KEYS.indexOf(world.presetName);
  setPreset(PRESET_KEYS[(i + 1) % PRESET_KEYS.length]);
}
function toggleSound() {
  if (!audio.ctx) { audio.start(); $('btnSound').textContent = 'Sonido: Sí'; return; }
  const m = audio.toggleMute();
  $('btnSound').textContent = 'Sonido: ' + (m ? 'No' : 'Sí');
}
function resetCar() {
  if (mode === 'auto') auto.reset();
  else {
    const z = Math.max(-10, Math.min(10, phys.z));
    phys.reset(phys.x, z, Math.abs(Math.sin(phys.heading)) > 0.5 ? (Math.sin(phys.heading) > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI / 2);
  }
  smoke.clear();
}
$('btnMode').onclick = () => setMode(mode === 'auto' ? 'manual' : 'auto');
$('btnCam').onclick = () => setCam((camIdx + 1) % CAMS.length);
$('btnTime').onclick = cyclePreset;
$('btnSound').onclick = toggleSound;
$('btnHelp').onclick = () => $('help').classList.toggle('hidden');
$('startBtn').onclick = () => {
  audio.start();
  $('btnSound').textContent = 'Sonido: Sí';
  $('start').classList.add('gone');
};
$('startMute').onclick = () => $('start').classList.add('gone');

// LEDs de cambio
const leds = [];
for (let i = 0; i < 15; i++) { const d = document.createElement('i'); $('leds').appendChild(d); leds.push(d); }

// ---------------------------------------------------------------- cámaras
const tv = { timer: 0, shot: null, pos: new THREE.Vector3(), last: '' };
let camYaw = Math.PI / 2;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), lastCarPos = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
let fovTarget = 55;

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function updateCamera(dt, st) {
  const cp = car.group.position;
  const vx = st.u * Math.sin(st.heading) + st.v * Math.cos(st.heading);
  const vz = st.u * Math.cos(st.heading) - st.v * Math.sin(st.heading);
  const spd = Math.hypot(vx, vz);
  const velAng = spd > 3 ? Math.atan2(vx, vz) : st.heading;
  const name = CAMS[camIdx];
  const k = (r) => 1 - Math.exp(-dt * r);

  if (name === 'Persecución') {
    const want = st.heading + angDiff(velAng, st.heading) * 0.6;
    // en los donuts la cámara gira despacio y se aleja: se ve el coche rotar
    const spin = THREE.MathUtils.clamp((Math.abs(st.r) - 1) / 1.2, 0, 1) * THREE.MathUtils.clamp(1 - spd / 25, 0, 1);
    camYaw += angDiff(want, camYaw) * k(3.2 - spin * 2.9);
    const dist = 7.6 + Math.min(spd, 80) * 0.035 + spin * 7;
    tmp.set(cp.x - Math.sin(camYaw) * dist, 2.0 + Math.min(spd, 80) * 0.006 + spin * 2.5, cp.z - Math.cos(camYaw) * dist);
    camera.position.lerp(tmp, k(9));
    lookTarget.set(cp.x + Math.sin(camYaw) * 3, 0.8, cp.z + Math.cos(camYaw) * 3);
    camera.lookAt(lookTarget);
    fovTarget = 55 + Math.min(spd, 85) * 0.14;
  } else if (name === 'TV') {
    tv.timer -= dt;
    const dist = camera.position.distanceTo(cp);
    if (tv.timer <= 0 || (tv.shot === 'pista' && dist > 150)) newTvShot(cp, velAng, spd);
    if (tv.shot === 'pista' || tv.shot === 'publico') {
      camera.position.copy(tv.pos);
      lookTarget.lerp(tmp.set(cp.x, 0.7, cp.z), k(12));
      camera.lookAt(lookTarget);
      fovTarget = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((tv.shot === 'publico' ? 9 : 6.5) / Math.max(dist, 1))), 5, 60);
    } else if (tv.shot === 'lateral') {
      const sa = velAng + Math.PI / 2 * tv.side;
      tmp.set(cp.x + Math.sin(sa) * 11 + Math.sin(velAng) * 2, 1.1, cp.z + Math.cos(sa) * 11 + Math.cos(velAng) * 2);
      tmp.z = THREE.MathUtils.clamp(tmp.z, -ROAD.halfWidth - 3, ROAD.halfWidth + 3);
      camera.position.lerp(tmp, k(3));
      lookTarget.lerp(tmp2.set(cp.x, 0.7, cp.z), k(14));
      camera.lookAt(lookTarget);
      fovTarget = 42;
    } else { // aéreo
      tmp.set(cp.x - Math.sin(velAng) * 24 + Math.sin(velAng + Math.PI / 2) * 12 * tv.side, 21, cp.z - Math.cos(velAng) * 24 + Math.cos(velAng + Math.PI / 2) * 12 * tv.side);
      camera.position.lerp(tmp, k(1.4));
      lookTarget.lerp(tmp2.set(cp.x, 0.5, cp.z), k(6));
      camera.lookAt(lookTarget);
      fovTarget = 36;
    }
  } else if (name === 'Helicóptero') {
    const a = performance.now() * 0.00007;
    tmp.set(cp.x + Math.sin(a) * 45, 32, cp.z + Math.cos(a) * 45 - 10);
    camera.position.lerp(tmp, k(1.5));
    lookTarget.lerp(tmp2.set(cp.x, 0, cp.z), k(5));
    camera.lookAt(lookTarget);
    fovTarget = 45;
  } else if (name === 'A bordo') {
    car.body.updateMatrixWorld();
    camera.position.copy(car.body.localToWorld(tmp.set(0, 1.2, -0.12)));
    camera.lookAt(car.body.localToWorld(tmp2.set(0, 0.95, 10)));
    fovTarget = 68;
  } else { // libre
    tmp.subVectors(cp, lastCarPos);
    camera.position.add(tmp);
    controls.target.add(tmp);
    controls.update();
    fovTarget = 50;
  }
  lastCarPos.copy(cp);
  if (Math.abs(camera.fov - fovTarget) > 0.01) {
    camera.fov += (fovTarget - camera.fov) * (name === 'TV' && (tv.shot === 'pista' || tv.shot === 'publico') ? 1 : k(4));
    camera.updateProjectionMatrix();
  }
}

function newTvShot(cp, velAng, spd) {
  const options = ['pista', 'lateral', 'aereo', 'publico', 'pista'].filter(s => s !== tv.last);
  const shot = options[Math.floor(Math.random() * options.length)];
  tv.shot = shot; tv.last = shot;
  tv.timer = 5 + Math.random() * 3;
  tv.side = Math.random() < 0.5 ? -1 : 1;
  const ahead = Math.max(12, Math.min(70, spd * 2.2));
  const side = Math.random() < 0.5 ? -1 : 1;
  if (shot === 'pista') {
    tv.pos.set(cp.x + Math.sin(velAng) * ahead, 1.5 + Math.random() * 1.2, side * (ROAD.halfWidth + 0.9));
  } else if (shot === 'publico') {
    tv.pos.set(cp.x + Math.sin(velAng) * ahead * 0.6 + (Math.random() - 0.5) * 10, 1.75, side * (ROAD.halfWidth + 3.6));
  }
  lookTarget.set(cp.x, 0.7, cp.z);
}

// ---------------------------------------------------------------- simulación
let simTime = 0, driftScore = 0, driftCombo = 0, comboTimer = 0;
function collide(p) {
  const lim = ROAD.halfWidth - 1.15;
  const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
  let vx = p.u * sh + p.v * ch, vz = p.u * ch - p.v * sh;
  let hit = false;
  if (Math.abs(p.z) > lim) { p.z = Math.sign(p.z) * lim; if (vz * Math.sign(p.z) > 0) { vz = -vz * 0.25; vx *= 0.75; hit = true; } }
  const xl = ROAD.xMax - 15;
  if (Math.abs(p.x) > xl) { p.x = Math.sign(p.x) * xl; if (vx * Math.sign(p.x) > 0) { vx = -vx * 0.25; vz *= 0.75; hit = true; } }
  if (hit) { p.u = vx * sh + vz * ch; p.v = vx * ch - vz * sh; p.r *= 0.4; p.rearSurface = p.u; }
}

function step(dt, silent = false) {
  simTime += dt;
  let st;
  if (mode === 'auto') { auto.update(dt); st = auto; }
  else { readInput(dt); phys.update(dt, input); collide(phys); st = phys; }
  car.update(st, dt, simTime);
  car.group.updateMatrixWorld(true);
  car.contacts(contacts);
  const sh = Math.sin(st.heading), ch = Math.cos(st.heading);
  const vel = { x: st.u * sh + st.v * ch, z: st.u * ch - st.v * sh };
  const zMax = ROAD.halfWidth - 0.2;
  skids.add(2, contacts[2], st.slideR, 0.38, zMax);
  skids.add(3, contacts[3], st.slideR, 0.38, zMax);
  skids.add(0, contacts[0], st.slideF, 0.28, zMax);
  skids.add(1, contacts[1], st.slideF, 0.28, zMax);
  smoke.emit(2, contacts[2], vel, st.slideR, dt);
  smoke.emit(3, contacts[3], vel, st.slideR, dt);
  smoke.emit(0, contacts[0], vel, st.slideF * 0.35, dt);
  smoke.emit(1, contacts[1], vel, st.slideF * 0.35, dt);
  smoke.update(dt, camera, { x: -1.6, z: 0.7 });
  updateCamera(dt, st);
  world.update(dt, simTime, car.group.position);
  // emoción del público: más cerca y más derrape = más saltos
  const near = Math.exp(-Math.abs(car.group.position.x - camera.position.x) / 120);
  world.crowd.excite.value += ((0.3 + st.slideR * 0.7) * (0.5 + near * 0.5) - world.crowd.excite.value) * Math.min(1, dt * 2);
  if (!silent) hud(st, dt);
  return st;
}

function hud(st, dt) {
  const kmh = Math.round(st.speed * 3.6);
  $('spd').textContent = kmh;
  $('gear').textContent = st.speed < 0.5 && st.u < 0 ? 'R' : (Math.abs(st.u) < 0.3 && st.throttle === 0 ? 'N' : st.gear);
  const frac = (st.rpm - 4000) / (12200 - 4000);
  const lit = Math.round(frac * 15);
  leds.forEach((l, i) => { l.className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : ''; });
  if (st.rpm > 11650) leds.forEach(l => (l.className = (Math.floor(simTime * 12) % 2 ? 'b' : '')));
  $('thr').style.width = Math.round(st.throttle * 100) + '%';
  $('brk').style.width = Math.round(st.brake * 100) + '%';
  const beta = Math.abs(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(st.slipAngle), Math.cos(st.slipAngle))));
  const drifting = beta > 12 && st.speed > 5;
  if (drifting) { driftCombo += beta * st.speed * dt * 0.6; comboTimer = 1.2; }
  else if ((comboTimer -= dt) <= 0 && driftCombo > 0) { driftScore += Math.round(driftCombo); driftCombo = 0; }
  $('drift').classList.toggle('on', drifting || comboTimer > 0);
  $('angle').textContent = Math.round(beta) + '°';
  $('combo').textContent = '+' + Math.round(driftCombo);
  $('score').textContent = (driftScore + Math.round(driftCombo)).toLocaleString('es-DO');
  if (mode === 'auto' && st.label) $('label').textContent = st.label;
}

// ---------------------------------------------------------------- bucle
const clock = new THREE.Clock();
let paused = false;
function frame() {
  if (paused) return;
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const st = step(dt);
  if (audio.ctx) {
    const cp = car.group.position;
    const toCam = tmp.subVectors(camera.position, cp);
    const dist = toCam.length();
    const sh = Math.sin(st.heading), ch = Math.cos(st.heading);
    const vx = st.u * sh + st.v * ch, vz = st.u * ch - st.v * sh;
    const radial = dist > 0.01 ? -(vx * toCam.x + vz * toCam.z) / dist : 0; // + = se aleja
    tmp2.copy(cp).project(camera);
    audio.update(st, {
      dist, radialVel: radial, pan: tmp2.z < 1 ? tmp2.x * 0.8 : 0, onboard: CAMS[camIdx] === 'A bordo',
      crowd: world.crowd.excite.value,
    }, simTime);
  }
  composer.render();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// arranque: dejamos que se pinte la pantalla de carga antes de generar texturas
requestAnimationFrame(() => setTimeout(() => {
  try {
    build();
    $('loading').textContent = 'Listo';
    $('startBtn').disabled = false; $('startMute').disabled = false;
    document.body.classList.add('ready');
    if (params.has('auto')) $('start').classList.add('gone');
    frame();
  } catch (err) {
    console.error(err);
    $('loading').textContent = 'Error al iniciar WebGL: ' + err.message;
  }
}, 30));

window.__malecon = { pause() { paused = true; }, render() { composer.render(); }, scene, renderer, composer, rt, bloom, get world() { return world; }, get car() { return car; }, get auto() { return auto; }, get phys() { return phys; }, step, setCam, setPreset, setMode, camera };
