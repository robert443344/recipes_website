// Texturas procedurales generadas con <canvas>: no se descarga ninguna imagen.
import * as THREE from 'three';

// ---------- utilidades de ruido (tileable) ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)), (s >>>= 0) / 4294967296);
}

/** Ruido fBm periódico (se repite sin costuras) en un array size×size con valores 0..1 */
export function tileNoise(size, baseFreq, octaves, seed = 1, gain = 0.5) {
  const out = new Float32Array(size * size);
  const rand = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = baseFreq << o;
    const lat = new Float32Array(f * f);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * f, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % f) * f, r1 = ((y0 + 1) % f) * f;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * f, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % f, c1 = (x0 + 1) % f;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Mapa de normales a partir de un mapa de alturas periódico */
function normalFromHeight(h, size, strength) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- asfalto ----------
export function asphalt() {
  const S = 512;
  const n1 = tileNoise(S, 8, 6, 11);
  const grain = tileNoise(S, 128, 2, 12);
  const patches = tileNoise(S, 3, 3, 13);
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  const rough = new Uint8ClampedArray(S * S * 4);
  const rand = rng(99);
  for (let i = 0; i < S * S; i++) {
    let v = 0.27 + (n1[i] - 0.5) * 0.10 + (grain[i] - 0.5) * 0.16 + (patches[i] - 0.5) * 0.10;
    if (rand() < 0.018) v += 0.16 * rand(); // piedrecitas claras del árido
    const base = Math.max(0, v) * 255;
    img.data[i * 4] = base * 1.0;
    img.data[i * 4 + 1] = base * 0.99;
    img.data[i * 4 + 2] = base * 0.97;
    img.data[i * 4 + 3] = 255;
    const r = 175 + (grain[i] - 0.5) * 120 - (patches[i] - 0.5) * 60;
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = r; rough[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const [rc, rg] = canvas(S);
  rg.putImageData(new ImageData(rough, S, S), 0, 0);
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hgt[i] = grain[i] * 0.7 + n1[i] * 0.3;
  return {
    map: tex(c),
    roughnessMap: tex(rc, { srgb: false }),
    normalMap: tex(normalFromHeight(hgt, S, 6), { srgb: false }),
  };
}

// ---------- normales del agua ----------
export function waterNormals() {
  const S = 512;
  const a = tileNoise(S, 4, 6, 21, 0.55);
  const b = tileNoise(S, 16, 4, 22, 0.5);
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.75 + b[i] * 0.25;
  const t = tex(normalFromHeight(h, S, 22), { srgb: false });
  return t;
}

// ---------- adoquines del paseo ----------
export function pavers() {
  const S = 512;
  const [c, g] = canvas(S);
  const n = tileNoise(S, 16, 4, 31);
  g.fillStyle = '#8f8172'; g.fillRect(0, 0, S, S);
  const rand = rng(32);
  const bw = S / 8, bh = S / 16;
  for (let row = 0; row < 16; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < 9; col++) {
      const t = rand();
      const base = t < 0.5 ? [196, 160, 128] : t < 0.8 ? [180, 120, 96] : [214, 196, 170];
      const k = 0.85 + rand() * 0.25;
      g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      g.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const m = 0.85 + n[i] * 0.3;
    img.data[i * 4] *= m; img.data[i * 4 + 1] *= m; img.data[i * 4 + 2] *= m;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- hormigón / piedra coralina ----------
export function concrete(seed = 41, tint = [200, 196, 188]) {
  const S = 256;
  const n = tileNoise(S, 8, 6, seed);
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const m = 0.72 + n[i] * 0.45;
    img.data[i * 4] = tint[0] * m; img.data[i * 4 + 1] = tint[1] * m; img.data[i * 4 + 2] = tint[2] * m; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- fachadas ----------
export function facade(kind, seed) {
  const W = 256, H = 512, K = 2; // se dibuja en 256×512 lógico a doble resolución
  const [c, g] = canvas(W * K, H * K);
  const [ec, eg] = canvas(W * K, H * K);
  g.scale(K, K); eg.scale(K, K);
  const rand = rng(seed);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H);
  const cols = 8, rows = 16, cw = W / cols, rh = H / rows;
  if (kind === 'glass') {
    const tint = [[40, 70, 95], [55, 85, 100], [35, 55, 70], [70, 95, 110]][Math.floor(rand() * 4)];
    g.fillStyle = `rgb(${tint})`; g.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const v = 0.75 + rand() * 0.4;
      g.fillStyle = `rgb(${tint[0] * v | 0},${tint[1] * v | 0},${tint[2] * v | 0})`;
      g.fillRect(k * cw + 1, r * rh + 1, cw - 2, rh - 3);
      if (rand() < 0.28) { eg.fillStyle = `rgb(255,${200 + rand() * 40 | 0},${130 + rand() * 60 | 0})`; eg.fillRect(k * cw + 2, r * rh + 2, cw - 4, rh - 5); }
    }
    g.fillStyle = 'rgba(200,210,215,0.55)';
    for (let r = 0; r < rows; r++) g.fillRect(0, r * rh + rh - 3, W, 3); // forjados
  } else {
    // bloque de apartamentos caribeño: estuco claro, balcones y ventanas
    const pal = [[236, 230, 214], [242, 236, 226], [226, 214, 190], [214, 222, 226], [240, 220, 200], [250, 245, 235]];
    const base = pal[Math.floor(rand() * pal.length)];
    g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, W, H);
    const n = tileNoise(64, 4, 3, seed);
    for (let i = 0; i < 64 * 64; i++) { // manchas de humedad tropical
      const x = (i % 64) * 4, y = ((i / 64) | 0) * 8;
      g.fillStyle = `rgba(80,70,60,${Math.max(0, n[i] - 0.55) * 0.35})`; g.fillRect(x, y, 4, 8);
    }
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols / 2; k++) {
      const x = k * cw * 2, y = r * rh;
      g.fillStyle = '#2b3138'; g.fillRect(x + 6, y + 5, cw * 2 - 12, rh - 9);
      g.fillStyle = 'rgba(150,180,200,0.6)'; g.fillRect(x + 8, y + 6, cw * 2 - 16, rh - 14);
      g.fillStyle = `rgb(${base.map(v => v * 0.9 | 0)})`; g.fillRect(x + 2, y + rh - 5, cw * 2 - 4, 4); // balcón
      g.fillStyle = 'rgba(60,60,60,0.8)';
      for (let b = 0; b < 10; b++) g.fillRect(x + 4 + b * (cw * 2 - 8) / 10, y + rh - 11, 1, 6);
      if (rand() < 0.3) { eg.fillStyle = `rgb(255,${190 + rand() * 50 | 0},${120 + rand() * 60 | 0})`; eg.fillRect(x + 8, y + 6, cw * 2 - 16, rh - 14); }
      if (rand() < 0.15) { g.fillStyle = '#d8d8d8'; g.fillRect(x + 10, y + 8, 10, 7); } // aire acondicionado
    }
  }
  const map = tex(c), emissiveMap = tex(ec);
  return { map, emissiveMap };
}

// ---------- palmeras ----------
export function frond() {
  const W = 128, H = 512, K = 2;
  const [c, g] = canvas(W * K, H * K);
  g.scale(K, K);
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  const rand = rng(51);
  // foliolos
  for (let y = 8; y < H - 4; y += 5) {
    const t = y / H;
    const len = (W / 2 - 4) * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (0.85 + rand() * 0.2);
    for (const side of [-1, 1]) {
      const gcol = 70 + rand() * 50;
      g.strokeStyle = `rgb(${40 + rand() * 30 | 0},${gcol | 0},${25 + rand() * 20 | 0})`;
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + side * len * 0.5, y + 6, W / 2 + side * len, y + 18 + t * 14);
      g.stroke();
    }
  }
  g.strokeStyle = '#7d7a3e'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function bark() {
  const W = 128, H = 256;
  const [c, g] = canvas(W, H);
  const n = tileNoise(128, 8, 4, 61);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ring = 0.75 + 0.25 * Math.pow(Math.abs(Math.sin((y / H) * Math.PI * 14)), 6);
    const m = (0.62 + n[(y % 128) * 128 + x] * 0.5) * (1.12 - ring * 0.35);
    const i = (y * W + x) * 4;
    img.data[i] = 150 * m; img.data[i + 1] = 135 * m; img.data[i + 2] = 112 * m; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- humo ----------
export function smokeSprite() {
  const S = 128;
  const [c, g] = canvas(S);
  const n = tileNoise(S, 4, 5, 71);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
    const d = Math.hypot(dx, dy);
    const fall = Math.max(0, 1 - d);
    const a = Math.pow(fall, 1.6) * (0.45 + n[y * S + x] * 0.9);
    const i = (y * S + x) * 4;
    const l = 210 + n[y * S + x] * 45;
    img.data[i] = l; img.data[i + 1] = l; img.data[i + 2] = l;
    img.data[i + 3] = Math.min(255, a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, { repeat: false });
  return t;
}

// ---------- bandera de la República Dominicana ----------
export function flagDR() {
  const W = 512, H = 320;
  const [c, g] = canvas(W, H);
  const blue = '#002D62', red = '#CE1126';
  const cw = W * 0.12, ch = H * 0.16; // ancho de la cruz blanca
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const qw = (W - cw) / 2, qh = (H - ch) / 2;
  g.fillStyle = blue; g.fillRect(0, 0, qw, qh); g.fillRect(qw + cw, qh + ch, qw, qh);
  g.fillStyle = red; g.fillRect(qw + cw, 0, qw, qh); g.fillRect(0, qh + ch, qw, qh);
  // escudo simplificado
  const cx = W / 2, cy = H / 2;
  g.strokeStyle = '#2e7d32'; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy + 4, 34, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); // laurel y palma
  g.fillStyle = '#ffffff'; g.fillRect(cx - 22, cy - 26, 44, 50);
  g.fillStyle = blue; g.fillRect(cx - 20, cy - 24, 19, 20); g.fillRect(cx + 1, cy - 2, 19, 22);
  g.fillStyle = red; g.fillRect(cx + 1, cy - 24, 19, 20); g.fillRect(cx - 20, cy - 2, 19, 22);
  g.fillStyle = '#ffffff'; g.fillRect(cx - 2, cy - 24, 4, 44); g.fillRect(cx - 20, cy - 5, 40, 4);
  g.fillStyle = '#c8a24a'; g.fillRect(cx - 5, cy - 12, 10, 12); // biblia
  g.fillStyle = blue; g.fillRect(cx - 30, cy - 38, 60, 8);
  g.fillStyle = red; g.fillRect(cx - 34, cy + 32, 68, 8);
  return tex(c, { repeat: false });
}

// ---------- fibra de carbono ----------
export function carbon() {
  const S = 64;
  const [c, g] = canvas(S);
  for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) {
    const even = ((x + y) / 8) % 2 === 0;
    const grd = even ? g.createLinearGradient(x, y, x + 8, y) : g.createLinearGradient(x, y, x, y + 8);
    grd.addColorStop(0, '#0b0b0d'); grd.addColorStop(0.5, '#2a2b30'); grd.addColorStop(1, '#0b0b0d');
    g.fillStyle = grd; g.fillRect(x, y, 8, 8);
  }
  const t = tex(c);
  t.repeat.set(6, 6);
  return t;
}

// ---------- tapacubos de rueda (para que se note el giro) ----------
export function wheelCover() {
  const S = 256;
  const [c, g] = canvas(S);
  const cx = S / 2;
  g.fillStyle = '#16171a'; g.fillRect(0, 0, S, S);
  const grd = g.createRadialGradient(cx, cx, 10, cx, cx, cx);
  grd.addColorStop(0, '#3a3c42'); grd.addColorStop(0.6, '#1d1e22'); grd.addColorStop(1, '#0d0d0f');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cx, cx - 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c9ccd2'; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cx, cx - 8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#e8e8e8';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.save(); g.translate(cx, cx); g.rotate(a);
    g.fillRect(-5, -cx + 22, 10, 34);
    g.restore();
  }
  g.fillStyle = '#d4af37'; g.beginPath(); g.arc(cx, cx, 16, 0, Math.PI * 2); g.fill();
  const t = tex(c, { repeat: false });
  return t;
}

/** Banda de color del flanco del neumático (compuesto blando = rojo) */
export function tireSidewall(color = '#e3262e') {
  const W = 512, H = 32;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#121214'; g.fillRect(0, 0, W, H);
  g.fillStyle = color; g.fillRect(0, 12, W, 6);
  g.fillStyle = '#d9d9d9';
  for (let i = 0; i < 4; i++) g.fillRect(i * 128 + 20, 22, 70, 4); // rotulado genérico
  return tex(c);
}

/** Dorsal / número para el morro y el alerón */
export function numberDecal(num = '27') {
  const [c, g] = canvas(256, 128);
  g.clearRect(0, 0, 256, 128);
  g.font = 'italic 900 104px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = '#002D62'; g.strokeText(num, 128, 68);
  g.fillStyle = '#ffffff'; g.fillText(num, 128, 68);
  return tex(c, { repeat: false });
}

/** Texto para el alerón trasero/pancartas */
export function banner(text, bg = '#002D62', fg = '#ffffff', w = 1024, h = 128) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.font = `italic 900 ${h * 0.62}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 4);
  return tex(c, { repeat: false });
}
