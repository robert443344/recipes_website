// Monoplaza de Fórmula 1 procedural (sin modelos externos).
// Ejes locales: +Z = hacia delante, +X = izquierda del piloto, +Y = arriba.
// El origen está en el centro de gravedad, a nivel del suelo.
import * as THREE from 'three';
import { carbon, wheelCover, numberDecal, banner } from './textures.js';

const DR_BLUE = 0x0b2f6b;
const DR_RED = 0xce1126;

const A = 1.62, B = 1.98;             // CG -> ejes
const TRACK_F = 0.80, TRACK_R = 0.775; // semivías (centro de rueda)
const RW = 0.36;                       // radio de rueda

// ---------------- geometría por secciones (loft) ----------------
// estación: [z, semiancho, techo, suelo, exponente superelipse, estrechamiento superior, centroX]
function loft(stations, { segs = 36, sub = 5, color = () => [1, 1, 1], capFront = true, capBack = true } = {}) {
  // interpolación Catmull-Rom de cada parámetro para superficies suaves
  const rows = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const p0 = stations[Math.max(0, i - 1)], p1 = stations[i], p2 = stations[i + 1], p3 = stations[Math.min(stations.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      rows.push(p1.map((_, j) => {
        const a = p0[j] ?? 0, b = p1[j] ?? 0, c = p2[j] ?? 0, d = p3[j] ?? 0;
        return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      }));
    }
  }
  rows.push(stations[stations.length - 1].slice());

  const pos = [], col = [], uv = [], idx = [];
  const ring = segs + 1;
  rows.forEach((st, ri) => {
    const [z, hw, top, bot, n = 3, taper = 1, cx = 0] = st;
    const yc = (top + bot) / 2, hh = (top - bot) / 2;
    for (let s = 0; s <= segs; s++) {
      const th = -Math.PI / 2 + (s / segs) * Math.PI * 2; // costura en la parte inferior
      const c = Math.cos(th), sn = Math.sin(th);
      const ey = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const tf = 1 + (taper - 1) * ((ey + 1) / 2);
      const x = cx + hw * ex * tf, y = yc + hh * ey;
      pos.push(x, y, z);
      const cc = color(z, ex, ey, x, y);
      col.push(cc[0], cc[1], cc[2]);
      uv.push(s / segs, ri / (rows.length - 1));
    }
  });
  for (let r = 0; r < rows.length - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * ring + s, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const capAt = (r, flip) => {
    const st = rows[r];
    const ci = pos.length / 3;
    pos.push(st[6] || 0, (st[2] + st[3]) / 2, st[0]);
    const cc = color(st[0], 0, 0, st[6] || 0, (st[2] + st[3]) / 2);
    col.push(cc[0], cc[1], cc[2]); uv.push(0.5, 0.5);
    for (let s = 0; s < segs; s++) {
      const a = r * ring + s, b = a + 1;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (capFront) capAt(0, true);
  if (capBack) capAt(rows.length - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Perfil alar extruido a lo largo de X (envergadura)
function wing(span, chord, thick, camber = 0.06) {
  const sh = new THREE.Shape();
  const N = 14;
  const up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const xc = (1 - Math.cos(t * Math.PI)) / 2; // reparto coseno
    const th = 5 * thick * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const cm = camber * 4 * xc * (1 - xc);
    // perfil invertido (genera carga): curvatura hacia abajo
    up.push([xc * chord, (-cm + th) * chord]);
    lo.push([xc * chord, (-cm - th) * chord]);
  }
  sh.moveTo(up[0][0], up[0][1]);
  for (let i = 1; i < up.length; i++) sh.lineTo(up[i][0], up[i][1]);
  for (let i = lo.length - 1; i >= 0; i--) sh.lineTo(lo[i][0], lo[i][1]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(Math.PI / 2); // forma: X->-Z (cuerda hacia atrás), extrusión Z->X
  g.translate(-span / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function rod(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

export class F1Car {
  constructor() {
    this.group = new THREE.Group();     // posición/guiñada en el mundo
    this.body = new THREE.Group();      // chasis (balanceo y cabeceo)
    this.group.add(this.body);
    this.wheels = [];
    this._build();
    this.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  _build() {
    const blue = lin(DR_BLUE), red = lin(DR_RED), white = lin(0xf4f4f4), black = lin(0x0a0a0c), gold = lin(0xd9b44a);

    const paint = new THREE.MeshPhysicalMaterial({
      vertexColors: true, metalness: 0.25, roughness: 0.3,
      clearcoat: 1, clearcoatRoughness: 0.03,
    });
    const carbonTex = carbon();
    const carbonMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1a1e, map: carbonTex, metalness: 0.2, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.15,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.25 });
    const redMat = new THREE.MeshPhysicalMaterial({ color: DR_RED, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
    const blueMat = new THREE.MeshPhysicalMaterial({ color: DR_BLUE, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
    const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, metalness: 0.1, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });

    // ---------- monocasco, morro y cubierta motor ----------
    const bodyStations = [
      [3.05, 0.07, 0.29, 0.21, 2.2, 1],
      [2.85, 0.10, 0.33, 0.18, 2.4, 1],
      [2.40, 0.14, 0.40, 0.15, 2.6, 0.9],
      [1.80, 0.21, 0.52, 0.12, 2.8, 0.85],
      [1.25, 0.29, 0.62, 0.10, 3.0, 0.85],
      [0.80, 0.36, 0.67, 0.08, 3.2, 0.85],
      [0.25, 0.42, 0.69, 0.07, 3.2, 0.85],
      [-0.10, 0.44, 0.74, 0.07, 3.0, 0.7],
      [-0.32, 0.40, 1.02, 0.07, 2.6, 0.32],
      [-0.60, 0.38, 0.98, 0.08, 2.5, 0.34],
      [-1.20, 0.30, 0.80, 0.10, 2.4, 0.45],
      [-1.80, 0.20, 0.60, 0.13, 2.4, 0.6],
      [-2.30, 0.13, 0.46, 0.17, 2.4, 0.8],
      [-2.55, 0.08, 0.40, 0.20, 2.2, 1],
    ];
    const bodyColor = (z, ex, ey, x, y) => {
      if (y < 0.16) return black;
      if (z > 2.78) return red;                                   // punta del morro
      if (z > 0.95 && Math.abs(ex) < 0.28 && ey > 0.55) return white; // franja blanca superior
      if (z < -0.2 && z > -0.5 && ey > 0.85) return black;         // arco antivuelco
      if (z < -0.75 && z > -1.05) return white;                    // anillo blanco
      if (z < -1.05 && z > -1.6 && ey > 0.2) return red;           // cubierta roja
      if (z < -2.3) return black;
      return blue;
    };
    this.body.add(new THREE.Mesh(loft(bodyStations, { color: bodyColor }), paint));

    // ---------- pontones ----------
    for (const side of [1, -1]) {
      const st = [
        [0.78, 0.15, 0.50, 0.17, 3, 1, 0.60],
        [0.58, 0.22, 0.56, 0.11, 3.6, 0.9, 0.62],
        [0.00, 0.23, 0.56, 0.10, 3.6, 0.85, 0.62],
        [-0.60, 0.18, 0.48, 0.10, 3.0, 0.8, 0.56],
        [-1.20, 0.10, 0.36, 0.11, 2.6, 0.8, 0.42],
        [-1.60, 0.05, 0.26, 0.12, 2.4, 1, 0.30],
      ].map(s => { const c = s.slice(); c[6] *= side; return c; });
      const pod = loft(st, {
        color: (z, ex, ey, x, y) => {
          if (y < 0.16) return black;
          if (ey > 0.25) return Math.abs(ey - 0.45) < 0.05 ? white : red;
          if (ey > 0.12) return white;
          return blue;
        },
      });
      this.body.add(new THREE.Mesh(pod, paint));
      // toma de aire del pontón
      const inlet = new THREE.Mesh(new THREE.CircleGeometry(1, 24), darkMat);
      inlet.scale.set(0.13, 0.15, 1);
      inlet.position.set(0.6 * side, 0.34, 0.785);
      this.body.add(inlet);
      // retrovisor
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.07, 0.05), blueMat);
      mir.position.set(0.56 * side, 0.74, 0.72);
      this.body.add(mir);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.055), new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 1, roughness: 0.05 }));
      glass.position.set(0.56 * side, 0.74, 0.694); glass.rotation.y = Math.PI;
      this.body.add(glass);
      this.body.add(rod(new THREE.Vector3(0.40 * side, 0.62, 0.70), new THREE.Vector3(0.52 * side, 0.73, 0.72), 0.012, carbonMat));
    }

    // toma de aire superior (airbox)
    const airbox = new THREE.Mesh(new THREE.CircleGeometry(1, 20), darkMat);
    airbox.scale.set(0.11, 0.09, 1);
    airbox.position.set(0, 0.92, -0.255);
    airbox.rotation.x = -0.25;
    this.body.add(airbox);
    // cámara T
    const tcam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    tcam.position.set(0, 1.05, -0.38);
    this.body.add(tcam);
    // aleta de tiburón
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0.9); finShape.lineTo(1.25, 0.5); finShape.lineTo(1.25, 0.6); finShape.quadraticCurveTo(0.5, 0.95, 0, 1.1); finShape.lineTo(0, 0.9);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.012, bevelEnabled: false }), blueMat);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(-0.006, 0, -0.72);
    this.body.add(fin);
    const finText = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.06), new THREE.MeshStandardMaterial({ roughness: 0.4, map: banner('RD 27', '#0b2f6b', '#ffffff', 512, 64), transparent: true }));
    for (const side of [1, -1]) {
      const t = finText.clone();
      t.position.set(0.008 * side, 0.95, -1.0);
      t.rotation.y = side * Math.PI / 2;
      t.material = finText.material;
      this.body.add(t);
    }

    // número en el morro
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), new THREE.MeshStandardMaterial({
      map: numberDecal('27'), transparent: true, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    num.rotation.x = -Math.PI / 2 + 0.19;
    num.rotation.z = Math.PI;
    num.position.set(0, 0.452, 2.1);
    this.body.add(num);

    // ---------- fondo plano y difusor ----------
    const fl = new THREE.Shape();
    fl.moveTo(-0.25, 1.30); fl.lineTo(-0.80, 0.85); fl.lineTo(-0.82, -1.35); fl.lineTo(-0.55, -1.75); fl.lineTo(-0.5, -2.30);
    fl.lineTo(0.5, -2.30); fl.lineTo(0.55, -1.75); fl.lineTo(0.82, -1.35); fl.lineTo(0.80, 0.85); fl.lineTo(0.25, 1.30); fl.lineTo(-0.25, 1.30);
    const floorGeo = new THREE.ExtrudeGeometry(fl, { depth: 0.025, bevelEnabled: false });
    floorGeo.rotateX(Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, carbonMat);
    floor.position.y = 0.085;
    this.body.add(floor);
    const diff = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.012, 0.5), carbonMat);
    diff.position.set(0, 0.14, -2.35); diff.rotation.x = -0.32;
    this.body.add(diff);
    for (const x of [-0.46, -0.16, 0.16, 0.46]) {
      const strake = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.16, 0.48), carbonMat);
      strake.position.set(x, 0.14, -2.33); strake.rotation.x = -0.32;
      this.body.add(strake);
    }

    // ---------- alerón delantero ----------
    const fw = new THREE.Group();
    const elems = [
      { chord: 0.30, y: 0.085, z: 3.02, ang: 0.04, span: 1.88, mat: blueMat },
      { chord: 0.19, y: 0.135, z: 2.80, ang: 0.28, span: 1.80, mat: carbonMat },
      { chord: 0.16, y: 0.19, z: 2.70, ang: 0.48, span: 1.72, mat: redMat },
      { chord: 0.13, y: 0.245, z: 2.63, ang: 0.70, span: 1.64, mat: whiteMat },
    ];
    for (const e of elems) {
      const m = new THREE.Mesh(wing(e.span, e.chord, 0.1, 0.07), e.mat);
      m.position.set(0, e.y, e.z); m.rotation.x = e.ang;
      fw.add(m);
    }
    for (const side of [1, -1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.26, 0.52), redMat);
      ep.position.set(0.95 * side, 0.18, 2.80);
      fw.add(ep);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.5), carbonMat);
      foot.position.set(0.92 * side, 0.06, 2.80);
      fw.add(foot);
    }
    // pilares del morro al alerón
    for (const side of [1, -1]) fw.add(rod(new THREE.Vector3(0.06 * side, 0.22, 2.70), new THREE.Vector3(0.09 * side, 0.12, 2.82), 0.012, carbonMat));
    this.body.add(fw);

    // ---------- alerón trasero ----------
    const rwG = new THREE.Group();
    const main = new THREE.Mesh(wing(1.0, 0.34, 0.12, 0.08), blueMat);
    main.position.set(0, 0.86, -2.22); main.rotation.x = 0.16;
    const flap = new THREE.Mesh(wing(1.0, 0.2, 0.1, 0.06), redMat);
    flap.position.set(0, 0.97, -2.50); flap.rotation.x = 0.52;
    this.flap = flap;
    const beam = new THREE.Mesh(wing(0.92, 0.17, 0.1, 0.05), carbonMat);
    beam.position.set(0, 0.42, -2.36); beam.rotation.x = 0.2;
    rwG.add(main, flap, beam);
    const epTex = banner('SANTO DOMINGO', '#0b2f6b', '#ffffff', 1024, 160);
    for (const side of [1, -1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.62, 0.72), blueMat);
      ep.position.set(0.51 * side, 0.72, -2.45);
      rwG.add(ep);
      const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1), new THREE.MeshStandardMaterial({ map: epTex, roughness: 0.35 }));
      dec.position.set(0.521 * side, 0.86, -2.45);
      dec.rotation.y = side * Math.PI / 2;
      rwG.add(dec);
    }
    // cuello de cisne y actuador DRS
    rwG.add(rod(new THREE.Vector3(0, 0.42, -2.40), new THREE.Vector3(0, 0.88, -2.30), 0.025, carbonMat));
    rwG.add(rod(new THREE.Vector3(0, 0.88, -2.30), new THREE.Vector3(0, 0.97, -2.42), 0.012, metal));
    this.body.add(rwG);

    // luz de lluvia trasera (LED rojo)
    this.rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 2 }));
    this.rainLight.position.set(0, 0.29, -2.565);
    this.body.add(this.rainLight);
    // escapes
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 14, 1, true), metal);
    exh.rotation.x = Math.PI / 2; exh.position.set(0, 0.5, -2.53);
    this.body.add(exh);
    this.exhaustGlow = new THREE.Mesh(new THREE.CircleGeometry(0.04, 14), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.0 }));
    this.exhaustGlow.position.set(0, 0.5, -2.585); this.exhaustGlow.rotation.y = Math.PI;
    this.body.add(this.exhaustGlow);

    // ---------- halo ----------
    const haloCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.36, 0.72, -0.05), new THREE.Vector3(0.33, 0.86, 0.22), new THREE.Vector3(0.22, 0.92, 0.58),
      new THREE.Vector3(0, 0.93, 0.76), new THREE.Vector3(-0.22, 0.92, 0.58), new THREE.Vector3(-0.33, 0.86, 0.22),
      new THREE.Vector3(-0.36, 0.72, -0.05),
    ]);
    const halo = new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 48, 0.026, 10), carbonMat);
    this.body.add(halo);
    this.body.add(rod(new THREE.Vector3(0, 0.62, 1.05), new THREE.Vector3(0, 0.92, 0.78), 0.026, carbonMat));

    // ---------- piloto ----------
    const helmetTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#002D62'; g.fillRect(0, 70, 256, 22);
      g.fillStyle = '#CE1126'; g.fillRect(0, 92, 256, 14);
      g.fillStyle = '#d9b44a'; g.fillRect(0, 40, 256, 6);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 20), new THREE.MeshPhysicalMaterial({ map: helmetTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 }));
    helmet.scale.set(0.95, 1, 1.12);
    helmet.position.set(0, 0.8, 0.3);
    this.body.add(helmet);
    this.helmet = helmet;
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.138, 28, 10, Math.PI / 2 - 0.95, 1.9, 1.05, 0.42),
      new THREE.MeshPhysicalMaterial({ color: 0x111418, metalness: 1, roughness: 0.04, iridescence: 1, iridescenceIOR: 1.6 }),
    );
    visor.scale.copy(helmet.scale); visor.position.copy(helmet.position);
    this.body.add(visor);
    this.visor = visor;
    const cockpitRim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 32), carbonMat);
    cockpitRim.scale.set(0.3, 0.42, 0.4);
    cockpitRim.rotation.x = Math.PI / 2;
    cockpitRim.position.set(0, 0.685, 0.42);
    this.body.add(cockpitRim);
    const seatHole = new THREE.Mesh(new THREE.CircleGeometry(1, 28), darkMat);
    seatHole.scale.set(0.27, 0.39, 1);
    seatHole.rotation.x = -Math.PI / 2;
    seatHole.position.set(0, 0.70, 0.42);
    this.body.add(seatHole);

    // ---------- suspensión ----------
    const suspMat = carbonMat;
    for (const side of [1, -1]) {
      const hf = new THREE.Vector3(TRACK_F * side * 0.88, RW, A);
      this.body.add(rod(new THREE.Vector3(0.16 * side, 0.30, A + 0.25), hf.clone().add(new THREE.Vector3(0, -0.08, 0)), 0.013, suspMat));
      this.body.add(rod(new THREE.Vector3(0.16 * side, 0.30, A - 0.30), hf.clone().add(new THREE.Vector3(0, -0.08, 0)), 0.013, suspMat));
      this.body.add(rod(new THREE.Vector3(0.20 * side, 0.50, A + 0.20), hf.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.013, suspMat));
      this.body.add(rod(new THREE.Vector3(0.22 * side, 0.50, A - 0.25), hf.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.013, suspMat));
      this.body.add(rod(new THREE.Vector3(0.18 * side, 0.55, A - 0.05), hf.clone().add(new THREE.Vector3(0, -0.06, 0)), 0.011, suspMat));
      const hr = new THREE.Vector3(TRACK_R * side * 0.86, RW, -B);
      this.body.add(rod(new THREE.Vector3(0.18 * side, 0.26, -B + 0.35), hr.clone().add(new THREE.Vector3(0, -0.08, 0)), 0.014, suspMat));
      this.body.add(rod(new THREE.Vector3(0.14 * side, 0.30, -B - 0.25), hr.clone().add(new THREE.Vector3(0, -0.08, 0)), 0.014, suspMat));
      this.body.add(rod(new THREE.Vector3(0.16 * side, 0.50, -B + 0.25), hr.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.014, suspMat));
      this.body.add(rod(new THREE.Vector3(0.12 * side, 0.48, -B - 0.2), hr.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.014, suspMat));
    }

    // ---------- ruedas ----------
    const coverTex = wheelCover();
    const coverMat = new THREE.MeshStandardMaterial({ map: coverTex, metalness: 0.4, roughness: 0.45 });
    const blurMat = new THREE.MeshStandardMaterial({ color: 0x2a2b30, metalness: 0.4, roughness: 0.5 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.82, metalness: 0 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xe3262e, roughness: 0.6 }); // compuesto blando
    const makeWheel = (w) => {
      const prof = [
        [0.229, -w / 2 + 0.01], [0.30, -w / 2 - 0.006], [RW - 0.035, -w / 2 + 0.002], [RW - 0.01, -w / 2 + 0.022],
        [RW, -w / 2 + 0.055], [RW, w / 2 - 0.055], [RW - 0.01, w / 2 - 0.022], [RW - 0.035, w / 2 - 0.002],
        [0.30, w / 2 + 0.006], [0.229, w / 2 - 0.01],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const tg = new THREE.LatheGeometry(prof, 56);
      tg.rotateZ(Math.PI / 2);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tg, rubber));
      const covers = [], blurs = [];
      for (const s of [1, -1]) {
        const cov = new THREE.Mesh(new THREE.CircleGeometry(0.232, 40), coverMat);
        cov.rotation.y = s * Math.PI / 2;
        cov.position.x = s * (w / 2 - 0.012);
        spin.add(cov); covers.push(cov);
        const bl = new THREE.Mesh(new THREE.CircleGeometry(0.232, 40), blurMat);
        bl.rotation.y = s * Math.PI / 2; bl.position.x = s * (w / 2 - 0.011); bl.visible = false;
        spin.add(bl); blurs.push(bl);
        const band = new THREE.Mesh(new THREE.RingGeometry(0.288, 0.302, 56), bandMat);
        band.rotation.y = s * Math.PI / 2;
        band.position.x = s * (w / 2 + 0.0075);
        spin.add(band);
      }
      return { spin, covers, blurs };
    };
    const defs = [
      { x: TRACK_F, z: A, w: 0.30, front: true }, { x: -TRACK_F, z: A, w: 0.30, front: true },
      { x: TRACK_R, z: -B, w: 0.40, front: false }, { x: -TRACK_R, z: -B, w: 0.40, front: false },
    ];
    for (const d of defs) {
      const steerG = new THREE.Group();
      steerG.position.set(d.x, RW, d.z);
      const wh = makeWheel(d.w);
      steerG.add(wh.spin);
      // disco de freno incandescente
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0x2b2522, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 0.6 }));
      disc.rotation.z = Math.PI / 2;
      disc.position.x = -Math.sign(d.x) * (d.w / 2 - 0.04);
      steerG.add(disc);
      this.group.add(steerG);
      this.wheels.push({ ...d, steerG, spin: wh.spin, covers: wh.covers, blurs: wh.blurs, disc });
    }
  }

  /** Aplica el estado de la simulación al modelo */
  update(st, dt, time) {
    this.group.position.set(st.x, 0, st.z);
    this.group.rotation.y = st.heading;
    // balanceo/cabeceo muy rígidos (coche con carga aerodinámica)
    const roll = THREE.MathUtils.clamp(-st.accLat * 0.0035, -0.035, 0.035);
    const pitch = THREE.MathUtils.clamp(st.accLong * 0.0016, -0.03, 0.02);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 10);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 10);
    // vibración del motor
    const vib = 0.0012 + st.throttle * 0.0012;
    this.body.position.y = Math.sin(time * 190) * vib * 0.5 + Math.sin(time * 77) * vib * 0.5;

    for (const w of this.wheels) {
      if (w.front) w.steerG.rotation.y = st.steer;
      const ang = w.front ? st.wheelAngleF : st.wheelAngleR;
      const om = Math.abs(w.front ? st.wheelSpinF : st.wheelSpinR);
      w.spin.rotation.x = ang;
      const blurred = om > 55;
      w.covers.forEach(c => (c.visible = !blurred));
      w.blurs.forEach(b => (b.visible = blurred));
      // los discos se calientan con la frenada
      const heat = w.disc.material;
      heat.emissiveIntensity += ((st.brake > 0.5 ? st.brake * 3 : 0) - heat.emissiveIntensity) * Math.min(1, dt * (st.brake > 0.5 ? 2 : 0.6));
    }
    // DRS abierto en la pasada a fondo
    const drsTarget = st.speed > 70 && st.throttle > 0.9 ? 0.12 : 0.52;
    this.flap.rotation.x += (drsTarget - this.flap.rotation.x) * Math.min(1, dt * 6);
    // luz trasera: parpadeo en recuperación de energía (frenada / sin gas)
    const harvesting = st.brake > 0.2 || st.throttle < 0.1;
    this.rainLight.material.emissiveIntensity = harvesting ? (Math.floor(time * 4) % 2 ? 3 : 0.3) : 1.2;
    // llamarada del escape al levantar el pie a alta rpm
    const pop = st.throttle < 0.1 && st.rpm > 9000 ? Math.random() : 0;
    this.exhaustGlow.material.opacity = pop > 0.7 ? 0.9 : 0;
  }

  /** puntos de contacto de las ruedas (mundo): [delIzq, delDer, trasIzq, trasDer] */
  contacts(out) {
    const m = this.group.matrixWorld;
    const defs = [[TRACK_F, A], [-TRACK_F, A], [TRACK_R, -B], [-TRACK_R, -B]];
    defs.forEach(([x, z], i) => { out[i].set(x, 0.02, z).applyMatrix4(m); });
    return out;
  }
}

export const CAR_GEOM = { A, B, TRACK_F, TRACK_R, RW };
