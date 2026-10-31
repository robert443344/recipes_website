// Humo de neumáticos (billboards instanciados ordenados por profundidad) y marcas de goma en el asfalto.
import * as THREE from 'three';
import { smokeSprite } from './textures.js';

export class TireSmoke {
  constructor(scene, max = 2600) {
    this.max = max;
    this.p = [];   // partículas vivas
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // size, alpha, rot, shade
    geo.setAttribute('iOffset', this.aOff);
    geo.setAttribute('iData', this.aData);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null },
      uLit: { value: new THREE.Color(1, 0.9, 0.82) },
      uShadow: { value: new THREE.Color(0.42, 0.45, 0.52) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    }]);
    this.uniforms.map.value = smokeSprite();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, fog: true,
      vertexShader: /* glsl */`
        attribute vec3 iOffset; attribute vec4 iData;
        varying vec2 vUv; varying float vAlpha; varying float vShade; varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vShade = iData.w;
          vec4 mvPosition = modelViewMatrix * vec4(iOffset, 1.0);
          // se desvanece cerca de la cámara para no taparla
          vAlpha = iData.y * smoothstep(1.0, 3.0 + iData.x * 0.6, -mvPosition.z);
          float c = cos(iData.z), s = sin(iData.z);
          mvPosition.xy += mat2(c, -s, s, c) * position.xy * iData.x;
          vWorld = iOffset;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 uLit; uniform vec3 uShadow;
        varying vec2 vUv; varying float vAlpha; varying float vShade; varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          float a = t.a * vAlpha;
          if (a < 0.004) discard;
          // iluminación aproximada: la parte alta de la nube recibe el sol
          float l = clamp(0.35 + (1.0 - vUv.y) * 0.25 + vShade * 0.4, 0.0, 1.0);
          vec3 col = mix(uShadow, uLit, l) * (0.82 + t.r * 0.18);
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this._acc = [0, 0, 0, 0];
  }

  setColors(lit, shadowMul = 0.5) {
    this.uniforms.uLit.value.setRGB(lit[0], lit[1], lit[2]);
    this.uniforms.uShadow.value.setRGB(lit[0] * shadowMul, lit[1] * shadowMul, lit[2] * shadowMul * 1.1);
  }

  /** emite humo desde un punto de contacto */
  emit(i, pos, carVel, intensity, dt) {
    if (intensity <= 0.02) { this._acc[i] = 0; return; }
    this._acc[i] += dt * (16 + 50 * intensity);
    while (this._acc[i] >= 1) {
      this._acc[i] -= 1;
      if (this.p.length >= this.max) this.p.shift();
      const r = Math.random;
      this.p.push({
        x: pos.x + (r() - 0.5) * 0.4, y: 0.25 + r() * 0.2, z: pos.z + (r() - 0.5) * 0.4,
        vx: carVel.x * 0.25 + (r() - 0.5) * 2.2, vy: 0.4 + r() * 1.1, vz: carVel.z * 0.25 + (r() - 0.5) * 2.2,
        age: 0, life: 2.8 + r() * 3.2,
        s0: 0.45 + r() * 0.35, s1: 3.2 + r() * 3.2 * intensity,
        a: 0.10 + 0.20 * intensity, rot: r() * 6.28, vr: (r() - 0.5) * 0.8, shade: r(),
      });
    }
  }

  update(dt, camera, wind) {
    const ps = this.p;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.age += dt;
      if (q.age >= q.life) { ps.splice(i, 1); continue; }
      const drag = Math.exp(-dt * 1.6);
      q.vx = q.vx * drag + wind.x * (1 - drag);
      q.vz = q.vz * drag + wind.z * (1 - drag);
      q.vy = q.vy * Math.exp(-dt * 0.8) + dt * 0.25;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.vr * dt;
    }
    // ordenar de atrás hacia delante respecto a la cámara
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (const q of ps) q.d = (q.x - cx) ** 2 + (q.y - cy) ** 2 + (q.z - cz) ** 2;
    ps.sort((a, b) => b.d - a.d);
    const off = this.aOff.array, data = this.aData.array;
    for (let i = 0; i < ps.length; i++) {
      const q = ps[i];
      const t = q.age / q.life;
      const size = q.s0 + (q.s1 - q.s0) * (1 - Math.pow(1 - t, 2.2));
      const alpha = q.a * Math.min(1, q.age * 6) * Math.pow(1 - t, 1.5);
      off[i * 3] = q.x; off[i * 3 + 1] = Math.max(q.y, size * 0.32); off[i * 3 + 2] = q.z;
      data[i * 4] = size; data[i * 4 + 1] = alpha; data[i * 4 + 2] = q.rot; data[i * 4 + 3] = q.shade;
    }
    this.geo.instanceCount = ps.length;
    this.aOff.needsUpdate = true; this.aData.needsUpdate = true;
  }

  clear() { this.p.length = 0; this.geo.instanceCount = 0; }
}

export class SkidMarks {
  constructor(scene, max = 14000) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.82, metalness: 0, envMapIntensity: 0.15, transparent: true, opacity: 0.72, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(0, 0, 0));
    scene.add(this.mesh);
    this.next = 0; this.total = 0;
    this.last = [null, null, null, null];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  add(i, pos, intensity, width, maxAbsZ) {
    if (intensity < 0.08 || Math.abs(pos.z) > maxAbsZ) { this.last[i] = null; return; }
    const l = this.last[i];
    if (!l) { this.last[i] = pos.clone(); return; }
    const dx = pos.x - l.x, dz = pos.z - l.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) return;
    if (len > 4) { l.copy(pos); return; } // teletransporte o salto
    this._p.set((pos.x + l.x) / 2, 0.006, (pos.z + l.z) / 2);
    this._q.setFromAxisAngle(this._up, Math.atan2(dx, dz));
    this._s.set(width, 1, len + 0.04);
    this._m.compose(this._p, this._q, this._s);
    const k = this.next;
    this.mesh.setMatrixAt(k, this._m);
    const g = 0.05 - 0.045 * Math.min(1, intensity);
    this.mesh.setColorAt(k, this._c.setRGB(g * 0.9, g * 0.9, g));
    this.next = (k + 1) % this.max;
    this.total++;
    this.mesh.count = Math.min(this.total, this.max);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    l.copy(pos);
  }

  clear() { this.total = 0; this.next = 0; this.mesh.count = 0; this.last.fill(null); }
}
