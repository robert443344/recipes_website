// Escenario: el Malecón de Santo Domingo (Av. George Washington) cerrado para una exhibición de F1.
// Eje X = a lo largo del Malecón (oeste -> este). Mar Caribe hacia -Z (sur). Ciudad hacia +Z.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';

export const ROAD = { halfWidth: 14, xMin: -450, xMax: 450 };
const SEA_LEVEL = -2.4;
const PROM = 0.15; // altura del paseo / aceras

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const PRESETS = {
  atardecer: {
    label: 'Atardecer', elev: 6.5, azim: -112, turbidity: 7, rayleigh: 2.6, mie: 0.006, mieG: 0.88,
    sunColor: 0xffb377, sunI: 3.2, hemiSky: 0x9fb4d8, hemiGround: 0x6b5a4a, hemiI: 0.55, exposure: 0.42,
    fog: 0xc9a58f, fogD: 0.0011, windows: 0.5, lamps: 1.5, lampLight: 0, water: 0x0f6a80, smoke: [1.0, 0.86, 0.78], moon: 0,
  },
  mediodia: {
    label: 'Mediodía', elev: 64, azim: -160, turbidity: 3.2, rayleigh: 1.2, mie: 0.004, mieG: 0.8,
    sunColor: 0xfff3e2, sunI: 3.6, hemiSky: 0xbfd6ff, hemiGround: 0x8a7a66, hemiI: 0.8, exposure: 0.32,
    fog: 0xb9d0e6, fogD: 0.0008, windows: 0, lamps: 0, lampLight: 0, water: 0x17a2b4, smoke: [1, 1, 1], moon: 0,
  },
  noche: {
    label: 'Noche', elev: -13, azim: -112, turbidity: 2, rayleigh: 0.6, mie: 0.003, mieG: 0.7,
    sunColor: 0x9db4ff, sunI: 0, hemiSky: 0x24304a, hemiGround: 0x2a2018, hemiI: 0.3, exposure: 0.6,
    fog: 0x0b0f18, fogD: 0.0016, windows: 1.1, lamps: 5, lampLight: 1, water: 0x05202c, smoke: [0.55, 0.48, 0.4], moon: 0.3, bloom: 0.5,
  },
};

export class World {
  constructor(scene, renderer, opts = {}) {
    this.mobile = !!opts.mobile;
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.updaters = [];
    this.windowMats = [];
    this.lampPositions = [];
    this._lights();
    this._sky();
    this._water();
    this._ground();
    this._markings();
    this._seawall();
    this._rocks();
    this._palms();
    this._lamps();
    this._barriersAndCrowd();
    this._buildings();
    this._obelisk();
    this._flags();
    this._ships();
    this.setPreset('atardecer');
  }

  // ------------------------------------------------------------------ luz
  _lights() {
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    const hi = Math.min(this.mobile ? 2048 : 4096, this.renderer.capabilities.maxTextureSize);
    sun.shadow.mapSize.set(hi, hi);
    const c = sun.shadow.camera;
    c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 1; c.far = 600;
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0);
    this.moon.position.set(200, 300, -150);
    this.scene.add(this.moon);
    // luces de farola reales: se recolocan cada fotograma en las farolas más cercanas al coche
    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffc488, 0, 38, 2);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.sunDir = new THREE.Vector3();
  }

  _sky() {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    this.scene.add(sky);
    this.sky = sky;
    // copia para generar el mapa de entorno (reflejos de la pintura)
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(10000);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
  }

  _water() {
    const normals = T.waterNormals();
    const water = new Water(new THREE.PlaneGeometry(20000, 20000), {
      textureWidth: this.mobile ? 256 : 512, textureHeight: this.mobile ? 256 : 512,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(),
      sunColor: 0xffffff,
      waterColor: 0x0d4c63,
      distortionScale: 3.2,
      fog: true,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = SEA_LEVEL;
    water.material.uniforms.size.value = 2.2;
    this.scene.add(water);
    this.water = water;

    // espuma de las olas rompiendo contra las rocas
    const foamTex = (() => {
      const S = 256, n = T.tileNoise(S, 8, 5, 77);
      const c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'), img = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const edge = Math.sin((y / S) * Math.PI);
        const a = Math.max(0, n[i] - 0.48) * 3.2 * edge;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = Math.min(255, a * 255);
      }
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.set(70, 1);
      return t;
    })();
    const foamMat = new THREE.MeshStandardMaterial({ map: foamTex, transparent: true, depthWrite: false, roughness: 0.9, color: 0xffffff, opacity: 0.8 });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(1000, 9), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, SEA_LEVEL + 0.12, -35);
    foam.renderOrder = 2;
    this.scene.add(foam);
    this.updaters.push((dt, t) => {
      foamTex.offset.x = t * 0.004;
      foamTex.offset.y = Math.sin(t * 0.5) * 0.06;
      foamMat.opacity = 0.55 + Math.sin(t * 0.9) * 0.25;
      water.material.uniforms.time.value += dt * 0.6;
    });
  }

  // ------------------------------------------------------------------ suelo
  _ground() {
    const L = ROAD.xMax - ROAD.xMin + 200;
    const a = T.asphalt();
    for (const t of [a.map, a.roughnessMap, a.normalMap]) t.repeat.set(L / 5, (ROAD.halfWidth * 2) / 5);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(L, ROAD.halfWidth * 2),
      new THREE.MeshStandardMaterial({ map: a.map, roughnessMap: a.roughnessMap, normalMap: a.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1, metalness: 0 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    this.scene.add(road);

    // bordillos
    const curbMat = new THREE.MeshStandardMaterial({ map: T.concrete(42, [190, 188, 182]), roughness: 0.85 });
    curbMat.map.repeat.set(L / 4, 1);
    for (const s of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(L, PROM + 0.02, 0.35), curbMat);
      curb.position.set(0, (PROM + 0.02) / 2, s * (ROAD.halfWidth + 0.175));
      curb.receiveShadow = curb.castShadow = true;
      this.scene.add(curb);
    }

    // paseo marítimo (lado mar) y acera (lado ciudad) con adoquines
    const pv = T.pavers();
    const promW = 11.6;
    const promMat = new THREE.MeshStandardMaterial({ map: pv, roughness: 0.8 });
    pv.repeat.set(L / 6, promW / 6);
    const prom = new THREE.Mesh(new THREE.BoxGeometry(L, 0.4, promW), promMat);
    prom.position.set(0, PROM - 0.2, -(ROAD.halfWidth + 0.35 + promW / 2));
    prom.receiveShadow = true;
    this.scene.add(prom);
    this.promZ = { min: -(ROAD.halfWidth + 0.35 + promW), max: -(ROAD.halfWidth + 0.35) };

    const pv2 = pv.clone(); pv2.repeat.set(L / 6, 10 / 6); pv2.needsUpdate = true;
    const side = new THREE.Mesh(new THREE.BoxGeometry(L, 0.4, 10), new THREE.MeshStandardMaterial({ map: pv2, roughness: 0.8 }));
    side.position.set(0, PROM - 0.2, ROAD.halfWidth + 0.35 + 5);
    side.receiveShadow = true;
    this.scene.add(side);

    // plaza del Obelisco
    const pv3 = pv.clone(); pv3.repeat.set(14, 10); pv3.needsUpdate = true;
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(90, 0.4, 60), new THREE.MeshStandardMaterial({ map: pv3, roughness: 0.75 }));
    plaza.position.set(0, PROM - 0.21, ROAD.halfWidth + 0.35 + 10 + 30);
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    // terreno urbano detrás (césped/solares)
    const g = T.concrete(43, [120, 128, 96]);
    g.repeat.set(200, 40);
    const city = new THREE.Mesh(new THREE.PlaneGeometry(3000, 900), new THREE.MeshStandardMaterial({ map: g, roughness: 0.95 }));
    city.rotation.x = -Math.PI / 2;
    city.position.set(0, 0.02, ROAD.halfWidth + 10 + 450);
    city.receiveShadow = true;
    this.scene.add(city);
  }

  _markings() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xefefef, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const L = ROAD.xMax - ROAD.xMin + 200;
    const line = (z, w, m) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(L, w), m);
      p.rotation.x = -Math.PI / 2; p.position.set(0, 0.004, z); p.receiveShadow = true;
      this.scene.add(p);
    };
    line(-0.18, 0.12, yel); line(0.18, 0.12, yel);
    line(-(ROAD.halfWidth - 0.5), 0.15, mat); line(ROAD.halfWidth - 0.5, 0.15, mat);
    // discontinuas entre carriles
    const dash = new THREE.PlaneGeometry(3, 0.13); dash.rotateX(-Math.PI / 2);
    const lanes = [-9.2, -4.6, 4.6, 9.2];
    const n = Math.floor(L / 9);
    const inst = new THREE.InstancedMesh(dash, mat, n * lanes.length);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (const z of lanes) for (let i = 0; i < n; i++) { m4.makeTranslation(-L / 2 + i * 9, 0.004, z); inst.setMatrixAt(k++, m4); }
    inst.receiveShadow = true;
    this.scene.add(inst);
    // línea de salida "pintada" para la exhibición
    const grid = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g.fillRect(x * 16, y * 16, 16, 16); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(2, ROAD.halfWidth * 2 - 1.2), new THREE.MeshStandardMaterial({ map: grid, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    fin.rotation.x = -Math.PI / 2; fin.rotation.z = Math.PI / 2;
    fin.position.set(-150, 0.005, 0);
    fin.receiveShadow = true;
    this.scene.add(fin);
  }

  // ------------------------------------------------------------------ muro y balaustrada
  _seawall() {
    const L = ROAD.xMax - ROAD.xMin + 200;
    const zWall = this.promZ.min;
    const wallMat = new THREE.MeshStandardMaterial({ map: T.concrete(44, [176, 170, 160]), roughness: 0.92 });
    wallMat.map.repeat.set(L / 5, 1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(L, 4.2, 1.2), wallMat);
    wall.position.set(0, PROM - 2.1 + 0.0, zWall - 0.4);
    wall.receiveShadow = wall.castShadow = true;
    this.scene.add(wall);

    const white = new THREE.MeshStandardMaterial({ color: 0xf0ebe0, roughness: 0.7 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.3), white);
    rail.position.set(0, PROM + 0.95, zWall + 0.2);
    rail.castShadow = rail.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(L, 0.16, 0.34), white);
    base.position.set(0, PROM + 0.08, zWall + 0.2);
    base.receiveShadow = true;
    this.scene.add(rail, base);
    // balaustres torneados
    const prof = [[0, 0], [0.07, 0], [0.07, 0.06], [0.05, 0.1], [0.04, 0.2], [0.075, 0.42], [0.04, 0.68], [0.045, 0.72], [0.065, 0.74], [0.065, 0.78], [0, 0.78]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const bal = new THREE.LatheGeometry(prof, 8);
    const spacing = 0.32;
    const n = Math.floor(L / spacing);
    const inst = new THREE.InstancedMesh(bal, white, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      // pilastras cada 3 m
      m.makeTranslation(-L / 2 + i * spacing, PROM + 0.16, zWall + 0.2);
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
    const post = new THREE.BoxGeometry(0.34, 1.0, 0.36);
    const np = Math.floor(L / 3.2);
    const posts = new THREE.InstancedMesh(post, white, np);
    for (let i = 0; i < np; i++) { m.makeTranslation(-L / 2 + i * 3.2, PROM + 0.5, zWall + 0.2); posts.setMatrixAt(i, m); }
    posts.castShadow = posts.receiveShadow = true;
    this.scene.add(posts);
  }

  _rocks() {
    // roca coralina "diente de perro"
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const p = geo.attributes.position;
    const rand = rng(5);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 5.1) * Math.cos(v.y * 4.3) * Math.sin(v.z * 6.7);
      const pit = Math.sin(v.x * 23) * Math.sin(v.y * 19) * Math.sin(v.z * 21);
      v.multiplyScalar(1 + n * 0.22 + pit * 0.06);
      v.y *= 0.6;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const tex = T.concrete(45, [92, 86, 78]);
    tex.repeat.set(2, 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, color: 0xb0a898 });
    const count = 1500;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), e = new THREE.Euler();
    const L = ROAD.xMax - ROAD.xMin + 200;
    for (let i = 0; i < count; i++) {
      const d = rand();
      pos.set(-L / 2 + rand() * L, SEA_LEVEL - 0.6 + (1 - d) * 1.6 + rand() * 0.4, this.promZ.min - 1.2 - d * 9);
      e.set(rand() * 6, rand() * 6, rand() * 6);
      q.setFromEuler(e);
      const sc = 0.8 + rand() * 1.8;
      s.set(sc * (1 + rand()), sc, sc * (1 + rand() * 0.5));
      m.compose(pos, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
  }

  // ------------------------------------------------------------------ palmeras
  _palmVariant(seed) {
    const rand = rng(seed);
    const H = 8.5 + rand() * 4;
    const lean = 0.6 + rand() * 1.6;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.2, H * 0.55, 0), new THREE.Vector3(lean, H, 0));
    // tronco con anillos y base ensanchada
    const segs = 28, rad = 10;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, c = curve.getPoint(t);
      const r = 0.2 * (1 - 0.3 * t) + 0.16 * Math.exp(-t * 14);
      for (let j = 0; j <= rad; j++) {
        const a = (j / rad) * Math.PI * 2;
        pos.push(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
        uv.push(j / rad, t * H / 2.2);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j, b = a + rad + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    let trunk = new THREE.BufferGeometry();
    trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    trunk.setIndex(idx);
    trunk.computeVertexNormals();
    const crown = curve.getPoint(1);
    const parts = [trunk];
    for (let i = 0; i < 6; i++) {
      const co = new THREE.SphereGeometry(0.16, 8, 6);
      const a = (i / 6) * Math.PI * 2 + rand();
      co.translate(crown.x + Math.cos(a) * 0.25, crown.y - 0.3 - rand() * 0.2, crown.z + Math.sin(a) * 0.25);
      parts.push(co);
    }
    // base de la copa
    const boot = new THREE.CylinderGeometry(0.28, 0.17, 0.7, 10);
    boot.translate(crown.x, crown.y - 0.2, crown.z);
    parts.push(boot);
    trunk = mergeGeometries(parts.map(g => { g.deleteAttribute('normal'); return g; }));
    trunk.computeVertexNormals();

    // hojas
    const fp = [], fu = [], fi = [];
    const nF = 15 + Math.floor(rand() * 5);
    for (let f = 0; f < nF; f++) {
      const az = (f / nF) * Math.PI * 2 + rand() * 0.3;
      const pitch = (f % 3 === 0 ? 0.9 : f % 3 === 1 ? 0.35 : -0.1) + rand() * 0.3;
      const len = 3.2 + rand() * 1.4;
      const droop = 0.18 + rand() * 0.14;
      const width = 1.5 + rand() * 0.5;
      const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const base = fp.length / 3;
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const s = i / N, d = s * len;
        const c = new THREE.Vector3().copy(crown).addScaledVector(dir, d * Math.cos(pitch) + 0.1);
        c.y += d * Math.sin(pitch) - droop * d * d;
        const w = width * 0.5;
        const fold = 0.12 * width * Math.sin(Math.min(1, s * 1.2) * Math.PI) * 0.5;
        const twist = s * 0.4 * (rand() - 0.5);
        const sd = side.clone().applyAxisAngle(dir, twist);
        for (const k of [-1, 0, 1]) {
          const pnt = c.clone().addScaledVector(sd, k * w);
          if (k !== 0) pnt.y -= fold * 2; // pliegue en V
          fp.push(pnt.x, pnt.y, pnt.z);
          fu.push((k + 1) / 2, s);
        }
      }
      for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) {
        const a = base + i * 3 + k, b = a + 3;
        fi.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const fronds = new THREE.BufferGeometry();
    fronds.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fronds.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    fronds.setIndex(fi);
    fronds.computeVertexNormals();
    return { trunk, fronds, crown };
  }

  _palms() {
    const rand = rng(17);
    const spots = [];
    for (let x = ROAD.xMin - 80; x < ROAD.xMax + 80; x += 15 + rand() * 6) spots.push([x, -21 + (rand() - 0.5) * 3]);
    for (let x = ROAD.xMin - 80; x < ROAD.xMax + 80; x += 20 + rand() * 8) if (Math.abs(x) > 46) spots.push([x, 18.2 + rand() * 1.5]);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; spots.push([Math.cos(a) * 24, 44 + Math.sin(a) * 17]); }
    this.palmSpots = spots;
    const variants = [this._palmVariant(3), this._palmVariant(8), this._palmVariant(13)];
    const barkMat = new THREE.MeshStandardMaterial({ map: T.bark(), roughness: 0.95 });
    const frondTex = T.frond();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    variants.forEach((v, vi) => {
      const mine = spots.filter((_, i) => i % 3 === vi);
      const frondMat = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xcfe0a8 });
      const uniforms = { uTime: { value: 0 }, uCrown: { value: v.crown } };
      frondMat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = 'uniform float uTime; uniform vec3 uCrown;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec3 rel = transformed - uCrown;
          float rr = length(rel.xz);
          float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + ph);
          transformed.x += (sin(uTime * 1.25 + ph) * 0.07 + sin(uTime * 3.3 + rr * 1.9 + ph) * 0.035) * rr * gust;
          transformed.z += sin(uTime * 1.05 + ph * 1.7) * 0.045 * rr * gust;
          transformed.y += sin(uTime * 2.7 + rr * 2.2 + ph) * 0.05 * rr * gust;
        `);
      };
      this.updaters.push((dt, t) => { uniforms.uTime.value = t; });
      const ti = new THREE.InstancedMesh(v.trunk, barkMat, mine.length);
      const fi = new THREE.InstancedMesh(v.fronds, frondMat, mine.length);
      mine.forEach(([x, z], i) => {
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        const sc = 0.85 + rand() * 0.35;
        s.set(sc, sc, sc);
        m.compose(new THREE.Vector3(x, PROM, z), q, s);
        ti.setMatrixAt(i, m); fi.setMatrixAt(i, m);
      });
      ti.castShadow = fi.castShadow = true;
      ti.receiveShadow = fi.receiveShadow = true;
      this.scene.add(ti, fi);
    });
  }

  // ------------------------------------------------------------------ farolas
  _lamps() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.7, roughness: 0.45 });
    const pole = new THREE.CylinderGeometry(0.07, 0.12, 9.5, 10); pole.translate(0, 4.75, 0);
    const arm = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 9.2, 0), new THREE.Vector3(0, 10.2, 0.6), new THREE.Vector3(0, 10, 2.4)), 12, 0.05, 6);
    const head = new THREE.BoxGeometry(0.42, 0.14, 0.9); head.translate(0, 9.95, 2.6);
    const baseG = new THREE.CylinderGeometry(0.2, 0.24, 0.6, 10); baseG.translate(0, 0.3, 0);
    const geo = mergeGeometries([pole, arm, head, baseG].map(g => { g.deleteAttribute('uv'); return g; }));
    const bulbGeo = new THREE.BoxGeometry(0.34, 0.03, 0.75); bulbGeo.translate(0, 9.87, 2.6);
    this.bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc37a, emissiveIntensity: 1 });
    const spots = [];
    for (let x = ROAD.xMin - 60; x < ROAD.xMax + 60; x += 34) {
      spots.push([x, -(ROAD.halfWidth + 1.6), 0]);
      spots.push([x + 17, ROAD.halfWidth + 1.6, Math.PI]);
    }
    const inst = new THREE.InstancedMesh(geo, metal, spots.length);
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
      m.compose(new THREE.Vector3(x, PROM, z), q, one);
      inst.setMatrixAt(i, m); bulbs.setMatrixAt(i, m);
      this.lampPositions.push(new THREE.Vector3(x, PROM + 9.7, z + (r === 0 ? 2.6 : -2.6)));
    });
    inst.castShadow = true;
    this.scene.add(inst, bulbs);
  }

  // ------------------------------------------------------------------ vallas y público
  _barriersAndCrowd() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.85, roughness: 0.35 });
    const parts = [];
    const L = 2.4;
    for (const y of [0.25, 1.05]) { const c = new THREE.CylinderGeometry(0.022, 0.022, L, 6); c.rotateZ(Math.PI / 2); c.translate(0, y, 0); parts.push(c); }
    for (let i = 0; i <= 14; i++) { const c = new THREE.CylinderGeometry(0.01, 0.01, 0.8, 4); c.translate(-L / 2 + (i / 14) * L, 0.65, 0); parts.push(c); }
    for (const x of [-L / 2 + 0.05, L / 2 - 0.05]) {
      const c = new THREE.CylinderGeometry(0.022, 0.022, 1.05, 6); c.translate(x, 0.55, 0); parts.push(c);
      const f = new THREE.BoxGeometry(0.05, 0.03, 0.7); f.translate(x, 0.02, 0); parts.push(f);
    }
    const geo = mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g; }));
    const xs = [];
    for (let x = -330; x < 330; x += L + 0.05) xs.push(x);
    const inst = new THREE.InstancedMesh(geo, steel, xs.length * 2);
    const m = new THREE.Matrix4();
    xs.forEach((x, i) => {
      m.makeTranslation(x, PROM, -(ROAD.halfWidth + 0.75)); inst.setMatrixAt(i * 2, m);
      m.makeTranslation(x, PROM, ROAD.halfWidth + 0.75); inst.setMatrixAt(i * 2 + 1, m);
    });
    inst.castShadow = true;
    this.scene.add(inst);

    // público: cuerpos (ropa de colores) + cabezas (tonos de piel)
    const rand = rng(23);
    const tint = (g, c) => {
      g.deleteAttribute('uv');
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const cc = typeof c === 'function' ? c(g, i) : c; a[i * 3] = cc[0]; a[i * 3 + 1] = cc[1]; a[i * 3 + 2] = cc[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const pants = [0.22, 0.24, 0.3], shoe = [0.08, 0.08, 0.08], shirt = [1, 1, 1];
    const bodyParts = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.075, 0.062, 0.82, 7); leg.translate(sx * 0.09, 0.45, 0); bodyParts.push(tint(leg, pants));
      const sh = new THREE.BoxGeometry(0.11, 0.07, 0.24); sh.translate(sx * 0.09, 0.035, 0.04); bodyParts.push(tint(sh, shoe));
      const arm = new THREE.CylinderGeometry(0.05, 0.042, 0.62, 6); arm.rotateZ(sx * 0.12); arm.translate(sx * 0.25, 1.02, 0); bodyParts.push(tint(arm, shirt));
    }
    const torso = new THREE.CapsuleGeometry(0.17, 0.42, 4, 10); torso.scale(1, 1, 0.68); torso.translate(0, 1.07, 0);
    bodyParts.push(tint(torso, shirt));
    const bodyGeo = mergeGeometries(bodyParts);
    const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.12, 6); neck.translate(0, 1.42, 0);
    const skull = new THREE.SphereGeometry(0.108, 12, 9); skull.scale(0.92, 1.05, 1); skull.translate(0, 1.56, 0);
    const headGeo = mergeGeometries([
      tint(neck, [1, 1, 1]),
      tint(skull, (g, i) => { const y = g.attributes.position.getY(i) - 1.56, z = g.attributes.position.getZ(i); return y > 0.035 || (z < -0.03 && y > -0.04) ? [0.13, 0.1, 0.09] : [1, 1, 1]; }),
    ]);
    const people = [];
    const lampXs = this.lampPositions.map(p => p.x);
    const clear = (x, z) => !this.palmSpots.some(([px, pz]) => Math.abs(px - x) < 0.8 && Math.abs(pz - z) < 0.8) && !lampXs.some(lx => Math.abs(lx - x) < 0.6 && Math.abs(Math.abs(z) - (ROAD.halfWidth + 1.6)) < 0.6);
    for (let x = -300; x < 300; x += 0.62) {
      const dens = 0.35 + 0.6 * Math.exp(-((x / 140) ** 2));
      for (const side of [-1, 1]) {
        const rows = side < 0 ? 4 : 3;
        for (let r = 0; r < rows; r++) {
          if (rand() > dens * (1 - r * 0.18)) continue;
          const z = side * (ROAD.halfWidth + 1.45 + r * 0.7 + rand() * 0.3);
          const xx = x + (rand() - 0.5) * 0.3;
          if (clear(xx, z)) people.push([xx, z, 0.88 + rand() * 0.22]);
        }
      }
    }
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.6, vertexColors: true });
    const excite = { value: 0 }, time = { value: 0 };
    const bob = (sh) => {
      sh.uniforms.uT = time; sh.uniforms.uEx = excite;
      sh.vertexShader = 'uniform float uT; uniform float uEx;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float hid = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
        float jump = step(0.55, hid) * abs(sin(uT * (5.0 + hid * 3.0) + hid * 40.0)) * 0.12 * uEx;
        transformed.y += jump;
        transformed.x += sin(uT * 0.8 + hid * 30.0) * 0.03;
      `);
    };
    bodyMat.onBeforeCompile = bob; headMat.onBeforeCompile = bob;
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, people.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, people.length);
    const shirts = [0x002d62, 0xce1126, 0xffffff, 0xffffff, 0xf2c200, 0x1e88e5, 0x222222, 0xff7043, 0x43a047, 0xe91e63, 0x8d6e63, 0x00acc1];
    const skins = [0x5a3825, 0x7a4b2a, 0x8d5524, 0xa86b3c, 0xc68642, 0xe0ac69, 0x6b4226, 0x4a2c1d];
    const col = new THREE.Color();
    const s = new THREE.Vector3(), q = new THREE.Quaternion();
    const upAx = new THREE.Vector3(0, 1, 0);
    people.forEach(([x, z, h], i) => {
      s.set(1, h, 1);
      q.setFromAxisAngle(upAx, (z > 0 ? Math.PI : 0) + (rand() - 0.5) * 0.8);
      m.compose(new THREE.Vector3(x, PROM, z), q, s);
      bodies.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      bodies.setColorAt(i, col.setHex(shirts[Math.floor(rand() * shirts.length)]));
      heads.setColorAt(i, col.setHex(skins[Math.floor(rand() * skins.length)]));
    });
    bodies.castShadow = heads.castShadow = true;
    this.scene.add(bodies, heads);
    this.crowd = { excite, time };
    this.updaters.push((dt, t) => { time.value = t; });
  }

  // ------------------------------------------------------------------ edificios
  _buildings() {
    const rand = rng(31);
    const facades = [];
    for (let i = 0; i < 4; i++) facades.push({ kind: 'glass', ...T.facade('glass', 100 + i) });
    for (let i = 0; i < 6; i++) facades.push({ kind: 'stucco', ...T.facade('stucco', 200 + i) });
    const roofMat = new THREE.MeshStandardMaterial({ map: T.concrete(46, [150, 146, 140]), roughness: 0.9 });
    const tankGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.5, 12); tankGeo.translate(0, 0.75, 0);
    const tanks = [];
    const place = (x0, x1, zMin, hMin, hMax) => {
      let x = x0;
      while (x < x1) {
        const w = 14 + rand() * 18, d = 14 + rand() * 18;
        const tall = rand() < 0.22;
        const h = tall ? 70 + rand() * 70 : hMin + rand() * (hMax - hMin);
        const f = facades[tall || rand() < 0.25 ? Math.floor(rand() * 4) : 4 + Math.floor(rand() * 6)];
        const map = f.map.clone(), em = f.emissiveMap.clone();
        const fl = f.kind === 'glass' ? 3.6 : 3.2;
        map.repeat.set(Math.max(1, Math.round(w / 12)), h / (fl * 16));
        em.repeat.copy(map.repeat);
        map.needsUpdate = em.needsUpdate = true;
        const glass = f.kind === 'glass';
        const mat = new THREE.MeshStandardMaterial({
          map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.5,
          roughness: glass ? 0.12 : 0.85, metalness: glass ? 0.7 : 0.0,
        });
        this.windowMats.push(mat);
        const mats = [mat, mat, roofMat, roofMat, mat, mat];
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
        const z = zMin + rand() * 8 + d / 2;
        b.position.set(x + w / 2, h / 2, z);
        b.castShadow = true; b.receiveShadow = true;
        this.scene.add(b);
        if (!glass && h < 60) {
          const nt = 1 + Math.floor(rand() * 4);
          for (let k = 0; k < nt; k++) tanks.push([x + w / 2 + (rand() - 0.5) * (w - 3), h, z + (rand() - 0.5) * (d - 3)]);
        }
        x += w + 3 + rand() * 9;
      }
    };
    const zFront = ROAD.halfWidth + 11;
    place(ROAD.xMin - 350, -48, zFront, 18, 55);
    place(48, ROAD.xMax + 350, zFront, 18, 55);
    place(-48, 48, zFront + 62, 25, 60); // detrás de la plaza
    // segunda y tercera línea de ciudad
    place(ROAD.xMin - 500, ROAD.xMax + 500, zFront + 55, 12, 45);
    place(ROAD.xMin - 600, ROAD.xMax + 600, zFront + 120, 10, 35);
    // tinacos (depósitos de agua) en las azoteas
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6 });
    const ti = new THREE.InstancedMesh(tankGeo, tankMat, tanks.length);
    const m = new THREE.Matrix4();
    tanks.forEach(([x, y, z], i) => { m.makeTranslation(x, y, z); ti.setMatrixAt(i, m); });
    ti.castShadow = true;
    this.scene.add(ti);
  }

  _obelisk() {
    const mat = new THREE.MeshStandardMaterial({ map: T.concrete(47, [236, 232, 224]), roughness: 0.6 });
    const g = new THREE.Group();
    const base1 = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 9), mat); base1.position.y = 0.3;
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.6, 6.5), mat); base2.position.y = 1.4;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.95 * Math.SQRT2, 1.75 * Math.SQRT2, 38, 4, 1), mat);
    shaft.rotation.y = Math.PI / 4; shaft.position.y = 2.2 + 19;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.95 * Math.SQRT2, 2.6, 4), mat);
    tip.rotation.y = Math.PI / 4; tip.position.y = 2.2 + 38 + 1.3;
    g.add(base1, base2, shaft, tip);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(0, PROM, 44);
    this.scene.add(g);
  }

  _flags() {
    const tex = T.flagDR();
    const pole = new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.8, roughness: 0.3 });
    const spots = [[-14, 38], [-7, 33], [7, 33], [14, 38], [-60, -22.5], [60, -22.5], [-180, -22.5], [180, -22.5]];
    const flags = [];
    for (const [x, z] of spots) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 12, 8), pole);
      p.position.set(x, PROM + 6, z); p.castShadow = true;
      this.scene.add(p);
      const geo = new THREE.PlaneGeometry(3.2, 2.0, 24, 12);
      geo.translate(1.6, 0, 0);
      const f = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
      f.position.set(x + 0.05, PROM + 10.9, z);
      f.rotation.y = Math.PI * 0.85; // viento del mar (alisios del este-sureste)
      f.castShadow = true;
      this.scene.add(f);
      flags.push({ f, base: geo.attributes.position.array.slice(), ph: Math.random() * 10 });
    }
    this.updaters.push((dt, t) => {
      for (const { f, base, ph } of flags) {
        const p = f.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = base[i * 3], y = base[i * 3 + 1];
          const k = x / 3.2;
          p.setZ(i, (Math.sin(x * 2.1 - t * 7 + ph) * 0.22 + Math.sin(x * 3.7 + y * 1.3 - t * 11 + ph) * 0.06) * k);
          p.setY(i, y - k * k * 0.12 + Math.sin(x * 2 - t * 7 + ph) * 0.03 * k);
        }
        p.needsUpdate = true;
        f.geometry.computeVertexNormals();
      }
    });
  }

  _ships() {
    const hull = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
    const ship = new THREE.Group();
    const h = new THREE.Mesh(new THREE.BoxGeometry(180, 14, 28), hull); h.position.y = 4;
    const red = new THREE.Mesh(new THREE.BoxGeometry(180.5, 3, 28.5), new THREE.MeshStandardMaterial({ color: 0x8a1c1c })); red.position.y = -2.5;
    ship.add(h, red);
    const cols = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x7f8c8d, 0x8e44ad];
    for (let i = 0; i < 26; i++) for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 24), new THREE.MeshStandardMaterial({ color: cols[(i * 7 + k * 3) % cols.length], roughness: 0.8 }));
      c.position.set(-70 + i * 5.5, 12.3 + k * 2.6, 0);
      ship.add(c);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 16, 26), white); bridge.position.set(80, 19, 0);
    ship.add(bridge);
    ship.position.set(-900, SEA_LEVEL, -1800);
    ship.rotation.y = 0.15;
    this.scene.add(ship);
    // crucero rumbo al puerto de Sans Souci
    const cruise = new THREE.Group();
    const ch = new THREE.Mesh(new THREE.BoxGeometry(260, 22, 34), white); ch.position.y = 9;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(210, 14, 30), white); deck.position.set(-10, 27, 0);
    const funnel = new THREE.Mesh(new THREE.BoxGeometry(14, 12, 10), new THREE.MeshStandardMaterial({ color: 0x12355b })); funnel.position.set(-60, 39, 0);
    const winTex = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 512, 32); g.fillStyle = '#26323d'; for (let i = 0; i < 128; i++) g.fillRect(i * 4, 10, 2, 6); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const band = new THREE.Mesh(new THREE.PlaneGeometry(258, 8), new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winTex, emissive: 0xffd08a, emissiveIntensity: 0 }));
    band.position.set(0, 14, 17.1);
    this.windowMats.push(band.material);
    cruise.add(ch, deck, funnel, band);
    cruise.position.set(1400, SEA_LEVEL, -2600);
    cruise.rotation.y = -0.4;
    this.scene.add(cruise);
    this.updaters.push((dt) => { ship.position.x += dt * 2.5; cruise.position.x -= dt * 1.5; });
  }

  // ------------------------------------------------------------------ hora del día
  setPreset(name) {
    const p = PRESETS[name];
    this.preset = p; this.presetName = name;
    const phi = THREE.MathUtils.degToRad(90 - p.elev);
    const theta = THREE.MathUtils.degToRad(p.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = p.mieG;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.elev > 0 ? p.sunI : 0;
    this.sun.castShadow = p.elev > 0;
    this.moon.intensity = p.moon;
    this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround); this.hemi.intensity = p.hemiI;
    this.renderer.toneMappingExposure = p.exposure;
    this.scene.fog = new THREE.FogExp2(p.fog, p.fogD);
    this.water.material.uniforms.sunDirection.value.copy(this.sunDir).normalize();
    this.water.material.uniforms.sunColor.value.setHex(p.elev > 0 ? p.sunColor : 0x333a55);
    this.water.material.uniforms.waterColor.value.setHex(p.water);
    for (const m of this.windowMats) m.emissiveIntensity = p.windows;
    this.bulbMat.emissiveIntensity = p.lamps;
    this.lampLightOn = p.lampLight;
    // mapa de entorno a partir del cielo
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = name === 'noche' ? 0.6 : 1;
  }

  update(dt, t, focus) {
    this.time = t;
    for (const u of this.updaters) u(dt, t);
    // sombra del sol centrada en el coche
    const d = this.sunDir;
    this.sun.position.set(focus.x + d.x * 300, focus.y + d.y * 300, focus.z + d.z * 300);
    this.sun.target.position.copy(focus);
    // las 6 farolas más cercanas iluminan de verdad (de noche)
    if (this.lampLightOn) {
      const near = this.lampPositions
        .map(p => [p, (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2])
        .sort((a, b) => a[1] - b[1]).slice(0, this.lampLights.length);
      near.forEach(([p], i) => { this.lampLights[i].position.copy(p); this.lampLights[i].intensity = 220; });
    } else {
      for (const l of this.lampLights) l.intensity = 0;
    }
  }
}
