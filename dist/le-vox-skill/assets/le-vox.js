// Le'Vox — Standalone WebGL2 Pixel-Art 3D Engine & Authoring Kit
// Built automatically by scripts/build_dist.mjs. Zero external dependencies.
(function (root) {
  "use strict";

  // --- core/art.js ---
// core/art.js: Voxel slice builder with 2-pixel smooth normals, shell extraction & atlas packing.
(function (global) {
  'use strict';

  function Palette() {
    this.names = {};
    this.rgba = [[0, 0, 0, 0]];
  }
  Palette.prototype.add = function (name, hex, glow) {
    if (this.rgba.length > 255) throw new Error('the palette holds 255 materials');
    this.names[name] = this.rgba.length;
    this.rgba.push([
      parseInt(hex.substr(1, 2), 16),
      parseInt(hex.substr(3, 2), 16),
      parseInt(hex.substr(5, 2), 16),
      Math.round((glow || 0) * 255)
    ]);
    return this.names[name];
  };
  Palette.prototype.ensure = function (name, hex, glow) {
    if (this.names[name]) return this.names[name];
    return this.add(name, hex, glow);
  };
  Palette.prototype.bytes = function () {
    const b = new Uint8Array(256 * 4);
    this.rgba.forEach((c, i) => b.set(c, i * 4));
    return b;
  };

  function fill(def, pal) {
    if (def.vox) return def.vox;
    const pad = def.pad || 0, w = def.w + pad * 2, h = def.h + pad * 2, n = def.layers;
    const vox = new Uint8Array(w * h * n);
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const m = def.fn(x + 0.5 - w / 2, y + 0.5 - h / 2, z);
          if (m) {
            const id = typeof m === 'number' ? m : pal.names[m];
            if (!id) throw new Error(def.name + ': no material "' + m + '"');
            vox[(z * h + y) * w + x] = id;
          }
        }
      }
    }
    return (def.vox = vox);
  }

  function depths(vox, w, h, n) {
    const dep = new Uint8Array(w * h * n);
    for (let z = 0; z < n; z++) {
      const o = z * w * h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = o + y * w + x; if (!vox[i]) continue;
        let d = 5;
        if (x === 0 || y === 0) d = 0;
        else d = Math.min(d, dep[i - 1], dep[i - w], dep[i - w - 1], x + 1 < w ? dep[i - w + 1] : 0);
        dep[i] = d + 1;
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = o + y * w + x; if (!vox[i]) continue;
        let d = dep[i] - 1;
        if (x === w - 1 || y === h - 1) d = 0;
        else d = Math.min(d, dep[i + 1], dep[i + w], dep[i + w + 1], x > 0 ? dep[i + w - 1] : 0);
        dep[i] = d + 1;
      }
    }
    return dep;
  }

  function voxelise(def, pal, shell) {
    const pad = def.pad || 0, w = def.w + pad * 2, h = def.h + pad * 2, n = def.layers, wh = w * h;
    const vox = fill(def, pal), dep = depths(vox, w, h, n), soft = def.soft || 0, layers = [];
    for (let z = 0; z < n; z++) {
      let x0 = w, y0 = h, x1 = -1, y1 = -1, sides = false;
      const px = new Uint8Array(def.w * def.h * 4);
      for (let y = pad; y < h - pad; y++) for (let x = pad; x < w - pad; x++) {
        const i = z * wh + y * w + x, id = vox[i]; if (!id) continue;
        const d0 = dep[i], da = z + 1 < n ? dep[i + wh] : 0, db = z > 0 ? dep[i - wh] : 9;
        if (shell && d0 > shell && da > shell && db > shell) continue;
        let nx = 0, ny = 0, nz = 0, open = 0;
        if (d0 <= 2 || da <= 2 || db <= 2 || z + 2 >= n || (z > 1 && dep[i - 2 * wh] <= 2) || dep[i + 2 * wh] <= 2) {
          for (let dz = -2; dz <= 2; dz++) {
            const zz = z + dz; if (zz < 0) continue;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx, yy = y + dy;
              if (zz < n && xx >= 0 && yy >= 0 && xx < w && yy < h && vox[zz * wh + yy * w + xx]) continue;
              const k = 1 / (dx * dx + dy * dy + dz * dz);
              nx += dx * k; ny += dy * k; nz += dz * k; open++;
            }
          }
        }
        if (!open && d0 <= 5) {
          for (let r = 3; r <= 5 && !open; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && vox[z * wh + yy * w + xx]) continue;
            nx += dx; ny += dy; open++;
          }
        }
        if (z + 1 >= n || !vox[i + wh]) nz += 1.2;
        let len = Math.hypot(nx, ny, nz);
        if (len < 0.01 || !open) { nx = 0; ny = 0; nz = 1; } else { nx /= len; ny /= len; nz /= len; }
        if (def.bump) {
          const b = def.bump(x + 0.5 - w / 2, y + 0.5 - h / 2, z);
          if (b) { nx += b[0]; ny += b[1]; }
        }
        if (soft) { nx *= 1 - soft; ny *= 1 - soft; nz = nz * (1 - soft) + soft; }
        len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
        if (d0 === 1) sides = true;
        const lx = x - pad, ly = y - pad, j = (ly * def.w + lx) * 4;
        px[j] = id; px[j + 1] = Math.round(nx * 127 + 128); px[j + 2] = Math.round(ny * 127 + 128); px[j + 3] = Math.round(nz * 127 + 128);
        if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (ly < y0) y0 = ly; if (ly > y1) y1 = ly;
      }
      layers.push(x1 < 0 ? null : { px, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, sides });
    }
    return { vox, layers };
  }

  function Atlas(size) {
    this.size = size || 2048;
    this.data = new Uint8Array(this.size * this.size * 4);
    this.x = 1; this.y = 1; this.rowH = 0; this.used = 0;
  }
  Atlas.prototype.put = function (px, srcW, x0, y0, w, h) {
    if (this.x + w + 1 > this.size) { this.x = 1; this.y += this.rowH + 1; this.rowH = 0; }
    if (this.y + h + 1 > this.size) throw new Error('atlas full (' + this.size + 'x' + this.size + ')');
    for (let y = 0; y < h; y++) {
      this.data.set(px.subarray(((y0 + y) * srcW + x0) * 4, ((y0 + y) * srcW + x0 + w) * 4), ((this.y + y) * this.size + this.x) * 4);
    }
    const at = [this.x, this.y]; this.x += w + 1;
    if (h > this.rowH) this.rowH = h;
    this.used += w * h;
    return at;
  };
  Atlas.prototype.usage = function () {
    return this.used / (this.size * this.size);
  };

  function buildStack(def, pal, atlas, shell) {
    const v = voxelise(def, pal, shell), pad = def.pad || 0;
    const st = {
      name: def.name, def, shell, w: def.w, h: def.h, n: def.layers, pad,
      slices: [], runs: [], radius: Math.hypot(def.w, def.h) / 2, vox: v.vox, flat: def.layers === 1
    };
    const same = (A, B) => {
      if (A.x0 !== B.x0 || A.y0 !== B.y0 || A.w !== B.w || A.h !== B.h) return false;
      for (let y = A.y0; y < A.y0 + A.h; y++) {
        for (let i = (y * def.w + A.x0) * 4, e = i + A.w * 4; i < e; i++) if (A.px[i] !== B.px[i]) return false;
      }
      return true;
    };
    let prev = null;
    for (let z = 0; z < def.layers; z++) {
      const L = v.layers[z]; if (!L) { prev = null; continue; }
      const at = atlas.put(L.px, def.w, L.x0, L.y0, L.w, L.h);
      const sl = {
        z, n: 1, u: at[0], v: at[1], w: L.w, h: L.h,
        ox: L.x0 + L.w / 2 - def.w / 2, oy: L.y0 + L.h / 2 - def.h / 2, sides: L.sides
      };
      st.slices.push(sl);
      const run = st.runs[st.runs.length - 1];
      if (prev && run.n < 3 && L.sides && same(L, prev)) run.n++;
      else st.runs.push({ z, n: 1, u: sl.u, v: sl.v, w: sl.w, h: sl.h, ox: sl.ox, oy: sl.oy, sides: sl.sides });
      prev = L;
    }
    return st;
  }

  function hash(x, y, z) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  global.Art = { Palette, Atlas, buildStack, hash, noise };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- core/rig.js ---
// core/rig.js: Two-bone analytical IK walker for slice-stacked characters.
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const DEFAULTS = {
    thigh: 7, shin: 7, ankle: 1.5, hipHalf: 2.3, standHip: 13.0, kneeHint: 1,
    stride: 18, duty: 0.56, lift: 2.8, bob: 0.45, twist: 0.14, spine: 9.2,
    arms: true, shoulderHalf: 7.0, upperArm: 4.5, foreArm: 4.5, armSwing: 0.35
  };

  function solveTwoBone(A, B, L1, L2, hint) {
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const d = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, Math.hypot(dx, dy, dz)));
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const hdot = hint[0] * ux + hint[1] * uy + hint[2] * uz;
    let px = hint[0] - ux * hdot, py = hint[1] - uy * hdot, pz = hint[2] - uz * hdot;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-5) { px = -uy; py = ux; pz = 0; pl = Math.hypot(px, py) || 1; }
    px /= pl; py /= pl; pz /= pl;
    const along = (d * d + L1 * L1 - L2 * L2) / (2 * d);
    const out = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    return [A[0] + ux * along + px * out, A[1] + uy * along + py * out, A[2] + uz * along + pz * out];
  }

  function createWalker(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    return {
      c, x: 0, y: 0, h: 0, phase: 0, hipZ: c.standHip,
      feet: [{ x: 0, y: 0, z: 0, rot: 0, planted: true }, { x: 0, y: 0, z: 0, rot: 0, planted: true }]
    };
  }

  function place(w, x, y, heading) {
    w.x = x; w.y = y; w.h = heading; w.phase = 0; w.hipZ = w.c.standHip;
    const nx = -Math.sin(heading), ny = Math.cos(heading);
    for (let i = 0; i < 2; i++) {
      const s = i ? w.c.hipHalf : -w.c.hipHalf;
      w.feet[i] = { x: x + nx * s, y: y + ny * s, z: 0, rot: heading, planted: true };
    }
  }

  function step(w, nx, ny, heading, dt) {
    const c = w.c, dist = Math.hypot(nx - w.x, ny - w.y);
    w.x = nx; w.y = ny; w.h = heading;
    if (dist > 1e-4) w.phase = (w.phase + dist / c.stride) % 1;
    const fx = Math.cos(heading), fy = Math.sin(heading), rx = -fy, ry = fx;
    const moving = dist > 0.02;

    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const ph = (w.phase + i * 0.5) % 1;
      const sx = nx + rx * side * c.hipHalf, sy = ny + ry * side * c.hipHalf;
      if (!moving) {
        w.feet[i].x += (sx - w.feet[i].x) * Math.min(1, (dt || 1 / 60) * 10);
        w.feet[i].y += (sy - w.feet[i].y) * Math.min(1, (dt || 1 / 60) * 10);
        w.feet[i].z *= 0.8; w.feet[i].rot = heading; w.feet[i].planted = true;
      } else if (ph < c.duty) {
        const u = ph / c.duty;
        const off = (0.5 - u) * c.stride * 0.5;
        w.feet[i].x = sx + fx * off; w.feet[i].y = sy + fy * off;
        w.feet[i].z = 0; w.feet[i].rot = heading; w.feet[i].planted = true;
      } else {
        const u = (ph - c.duty) / (1 - c.duty);
        const off = (-0.5 + u) * c.stride * 0.5;
        w.feet[i].x = sx + fx * off; w.feet[i].y = sy + fy * off;
        w.feet[i].z = Math.sin(u * Math.PI) * c.lift;
        w.feet[i].rot = heading; w.feet[i].planted = false;
      }
    }

    const most = Math.min(
      Math.sqrt(Math.max(0.01, (c.thigh + c.shin - 0.1) ** 2 - (c.stride * 0.25) ** 2)),
      c.standHip
    );
    const want = moving ? Math.min(c.standHip, most) : c.standHip;
    w.hipZ += (want - w.hipZ) * Math.min(1, (dt || 1 / 60) * 14);
    if (w.hipZ > most) w.hipZ = most;
  }

  function pose(w) {
    const c = w.c, ph = w.phase * TAU, fwd = [Math.cos(w.h), Math.sin(w.h), 0];
    const twist = c.twist * Math.cos(ph), hipsAngle = w.h + twist, shouldersAngle = w.h - twist * 1.2;
    const pz = w.hipZ - c.bob * Math.cos(2 * ph);
    const P = {
      x: w.x, y: w.y, heading: w.h, phase: w.phase,
      pelvis: [w.x, w.y, pz], top: [w.x, w.y, pz + c.spine],
      hipsAngle, shouldersAngle, legs: [], arms: []
    };
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1, f = w.feet[i];
      const hip = [w.x - Math.sin(hipsAngle) * side * c.hipHalf, w.y + Math.cos(hipsAngle) * side * c.hipHalf, pz];
      const ankle = [f.x, f.y, f.z + c.ankle];
      P.legs.push({
        hip, knee: solveTwoBone(hip, ankle, c.thigh, c.shin, [fwd[0] * c.kneeHint, fwd[1] * c.kneeHint, 0]),
        ankle, sole: [f.x, f.y, f.z], rot: f.rot, planted: f.planted
      });
      if (!c.arms) continue;
      const sh = [w.x - Math.sin(shouldersAngle) * side * c.shoulderHalf, w.y + Math.cos(shouldersAngle) * side * c.shoulderHalf, pz + c.spine];
      const a = side * c.armSwing * Math.cos(ph), L = (c.upperArm + c.foreArm) * 0.93;
      const hand = [sh[0] + fwd[0] * Math.sin(a) * L, sh[1] + fwd[1] * Math.sin(a) * L, sh[2] - Math.cos(a) * L];
      P.arms.push({ shoulder: sh, elbow: solveTwoBone(sh, hand, c.upperArm, c.foreArm, [-fwd[0], -fwd[1], 0]), hand });
    }
    return P;
  }

  global.Rig = { solveTwoBone, createWalker, place, step, pose, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- core/dsl.js ---
// core/dsl.js: Declarative CSG/shape compiler for Art.buildStack.
// Compiles short JSON blueprints (box, cyl, ellipsoid, dome, ramp, torus, hollow, noisePaint)
// into centered voxel definitions with zero hand-written math inside scenes.
(function (global) {
  'use strict';

  function distSeg(px, py, pz, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / len2));
    return [
      Math.hypot(px - (a[0] + abx * t), py - (a[1] + aby * t), pz - (a[2] + abz * t)),
      t
    ];
  }

  function matchOp(op, x, y, z) {
    switch (op.op) {
      case 'box': {
        const mn = op.min, mx = op.max;
        return x >= mn[0] && x <= mx[0] && y >= mn[1] && y <= mx[1] && z >= mn[2] && z <= mx[2];
      }
      case 'cyl': {
        const [d, t] = distSeg(x, y, z, op.a, op.b);
        const r = op.r != null ? op.r : (op.rA + (op.rB - op.rA) * t);
        return d <= r;
      }
      case 'ellipsoid': {
        const c = op.center, r = op.radii;
        const dx = (x - c[0]) / r[0], dy = (y - c[1]) / r[1], dz = (z - c[2]) / r[2];
        return dx * dx + dy * dy + dz * dz <= 1;
      }
      case 'dome': {
        const c = op.center, r = op.radii;
        if (z < c[2]) return false;
        const dx = (x - c[0]) / r[0], dy = (y - c[1]) / r[1], dz = (z - c[2]) / r[2];
        return dx * dx + dy * dy + dz * dz <= 1;
      }
      case 'ramp': {
        const mn = op.min, mx = op.max;
        if (x < mn[0] || x > mx[0] || y < mn[1] || y > mx[1] || z < mn[2] || z > mx[2]) return false;
        const sx = (mx[0] - mn[0]) || 1, sy = (mx[1] - mn[1]) || 1, sz = (mx[2] - mn[2]) || 1;
        let u = 1;
        if (op.dir === '+x') u = (mx[0] - x) / sx;
        else if (op.dir === '-x') u = (x - mn[0]) / sx;
        else if (op.dir === '+y') u = (mx[1] - y) / sy;
        else if (op.dir === '-y') u = (y - mn[1]) / sy;
        return z <= mn[2] + sz * Math.max(0, Math.min(1, u));
      }
      case 'torus': {
        const c = op.center, R = op.R, r = op.r, ax = op.axis || 'z';
        let q1 = x - c[0], q2 = y - c[1], q3 = z - c[2];
        if (ax === 'x') { const tmp = q1; q1 = q3; q3 = tmp; }
        else if (ax === 'y') { const tmp = q2; q2 = q3; q3 = tmp; }
        const ring = Math.hypot(q1, q2) - R;
        return ring * ring + q3 * q3 <= r * r;
      }
      default:
        return false;
    }
  }

  function compile(spec) {
    const w = spec.w, h = spec.h, layers = spec.layers, pad = spec.pad || 0;
    const ops = spec.ops || [];
    const totalW = w + pad * 2, totalH = h + pad * 2, wh = totalW * totalH;

    // Evaluate all CSG/paint operations once into a flat material-name array (0 = empty)
    const matTable = [null];
    const matIdx = new Map();
    const getMatId = (name) => {
      if (!name) return 0;
      let id = matIdx.get(name);
      if (!id) { id = matTable.length; matTable.push(name); matIdx.set(name, id); }
      return id;
    };

    const grid = new Uint16Array(wh * layers);

    for (let o = 0; o < ops.length; o++) {
      const op = ops[o];

      if (op.op === 'hollow') {
        const minZ = op.minZ ?? 1, maxZ = op.maxZ ?? (layers - 2);
        const snap = grid.slice();
        for (let z = minZ; z <= maxZ; z++) {
          for (let y = 1; y < totalH - 1; y++) {
            for (let x = 1; x < totalW - 1; x++) {
              const i = z * wh + y * totalW + x;
              if (!snap[i]) continue;
              if (snap[i - 1] && snap[i + 1] && snap[i - totalW] && snap[i + totalW] && snap[i - wh] && snap[i + wh]) {
                grid[i] = 0;
              }
            }
          }
        }
        continue;
      }

      if (op.op === 'noisePaint') {
        const sc = op.scale || 0.3, seed = op.seed || 17, th = op.threshold ?? 0.6;
        const mid = getMatId(op.mat);
        const onlyId = op.onlyOver ? getMatId(op.onlyOver) : 0;
        for (let z = 0; z < layers; z++) {
          for (let y = 0; y < totalH; y++) {
            for (let x = 0; x < totalW; x++) {
              const i = z * wh + y * totalW + x;
              if (!grid[i]) continue;
              if (onlyId && grid[i] !== onlyId) continue;
              const wx = x + 0.5 - totalW / 2, wy = y + 0.5 - totalH / 2;
              const n = Art.noise(wx * sc + z * 2.7, wy * sc - z * 1.9, seed);
              if (n >= th) grid[i] = mid;
            }
          }
        }
        continue;
      }

      const mid = op.subtract ? 0 : getMatId(op.mat);
      const onlyId = op.onlyOver ? getMatId(op.onlyOver) : 0;

      for (let z = 0; z < layers; z++) {
        for (let y = 0; y < totalH; y++) {
          const wy = y + 0.5 - totalH / 2;
          for (let x = 0; x < totalW; x++) {
            const wx = x + 0.5 - totalW / 2;
            const i = z * wh + y * totalW + x;
            if (op.paintOnly && !grid[i]) continue;
            if (onlyId && grid[i] !== onlyId) continue;
            let hit = matchOp(op, wx, wy, z);
            if (!hit && op.mirrorY) hit = matchOp(op, wx, -wy, z);
            if (!hit && op.mirrorX) hit = matchOp(op, -wx, wy, z);
            if (hit) grid[i] = mid;
          }
        }
      }
    }

    return {
      name: spec.name,
      w,
      h,
      layers,
      pad,
      soft: spec.soft || 0,
      noShadow: !!spec.noShadow,
      ground: !!spec.ground,
      bump: spec.bump || null,
      shadowIf: spec.shadowIf || null,
      fn: function (x, y, z) {
        const ix = Math.floor(x + totalW / 2);
        const iy = Math.floor(y + totalH / 2);
        if (ix < 0 || ix >= totalW || iy < 0 || iy >= totalH || z < 0 || z >= layers) return null;
        return matTable[grid[z * wh + iy * totalW + ix]];
      }
    };
  }

  global.DSL = { compile };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- core/importers.js ---
// core/importers.js: Binary .vox (MagicaVoxel) and 2D slice-strip PNG importers for Art.buildStack.
(function (global) {
  'use strict';

  function toHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Minimal MagicaVoxel .vox parser (SIZE + XYZI + RGBA chunks, first model)
  function fromVox(arrayBuffer, pal, opts) {
    const o = opts || {};
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length < 20 ||
        String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'VOX ') {
      throw new Error('Invalid .vox header');
    }

    let w = 0, h = 0, layers = 0;
    let xyzi = null;
    let rgba = null;
    let pos = 8; // skip 'VOX ' + version (4 bytes)

    const readId = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);

    while (pos + 12 <= bytes.length) {
      const id = readId(pos);
      const contentBytes = dv.getInt32(pos + 4, true);
      const childrenBytes = dv.getInt32(pos + 8, true);
      const dataStart = pos + 12;

      if (id === 'MAIN') {
        pos = dataStart;
        continue;
      }
      if (id === 'SIZE' && w === 0) {
        // MagicaVoxel axes: X, Y (ground), Z (up)
        w = dv.getInt32(dataStart, true);
        h = dv.getInt32(dataStart + 4, true);
        layers = dv.getInt32(dataStart + 8, true);
      } else if (id === 'XYZI' && !xyzi) {
        const count = dv.getInt32(dataStart, true);
        xyzi = bytes.subarray(dataStart + 4, dataStart + 4 + count * 4);
      } else if (id === 'RGBA') {
        rgba = bytes.subarray(dataStart, dataStart + 256 * 4);
      }

      pos = dataStart + contentBytes + childrenBytes;
    }

    if (!w || !h || !layers || !xyzi) throw new Error('Incomplete .vox model (missing SIZE or XYZI)');

    const prefix = o.prefix || (o.name || 'vox') + '_';
    const indexMap = new Uint8Array(256);
    const vox = new Uint8Array(w * h * layers);

    for (let i = 0; i < xyzi.length; i += 4) {
      const vx = xyzi[i], vy = xyzi[i + 1], vz = xyzi[i + 2], ci = xyzi[i + 3];
      if (!ci || vx >= w || vy >= h || vz >= layers) continue;
      if (!indexMap[ci]) {
        const pOff = (ci - 1) * 4;
        const r = rgba ? rgba[pOff] : ((ci * 73) & 255);
        const g = rgba ? rgba[pOff + 1] : ((ci * 151) & 255);
        const b = rgba ? rgba[pOff + 2] : ((ci * 211) & 255);
        const glow = o.emissiveIndices && o.emissiveIndices.includes(ci) ? 1.0 : 0.0;
        indexMap[ci] = pal.ensure(prefix + ci, toHex(r, g, b), glow);
      }
      vox[(vz * h + vy) * w + vx] = indexMap[ci];
    }

    return {
      name: o.name || 'voxModel',
      w, h, layers,
      pad: 0,
      soft: o.soft || 0,
      noShadow: !!o.noShadow,
      vox
    };
  }

  // Convert a horizontal RGBA slice strip (e.g. output of views_to_slices.py) into an Art def.
  // Ground slice z=0 is on the left.
  function fromSliceStrip(rgbaPixels, imgW, imgH, sliceW, sliceH, pal, opts) {
    const o = opts || {};
    const layers = o.layers || Math.floor(imgW / sliceW);
    const prefix = o.prefix || (o.name || 'strip') + '_';
    const quantStep = o.quantStep || 4; // collapse near-identical shades to preserve 255-color palette budget
    const vox = new Uint8Array(sliceW * sliceH * layers);

    for (let z = 0; z < layers; z++) {
      const ox = z * sliceW;
      for (let y = 0; y < sliceH; y++) {
        for (let x = 0; x < sliceW; x++) {
          const p = ((y * imgW) + ox + x) * 4;
          const a = rgbaPixels[p + 3];
          if (a < 128) continue;
          const r = Math.min(255, Math.round(rgbaPixels[p] / quantStep) * quantStep);
          const g = Math.min(255, Math.round(rgbaPixels[p + 1] / quantStep) * quantStep);
          const b = Math.min(255, Math.round(rgbaPixels[p + 2] / quantStep) * quantStep);
          const hex = toHex(r, g, b);
          const id = pal.ensure(prefix + hex, hex, 0);
          vox[(z * sliceH + y) * sliceW + x] = id;
        }
      }
    }

    return {
      name: o.name || 'sliceStrip',
      w: sliceW,
      h: sliceH,
      layers,
      pad: 0,
      soft: o.soft || 0,
      noShadow: !!o.noShadow,
      vox
    };
  }

  // Browser helper: reads an HTMLImageElement / ImageBitmap slice strip via offscreen canvas
  function fromSliceImage(img, sliceW, sliceH, pal, opts) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    return fromSliceStrip(data, c.width, c.height, sliceW, sliceH, pal, opts);
  }

  global.Importers = { fromVox, fromSliceStrip, fromSliceImage };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- core/exporters.js ---
// core/exporters.js: Greedy-meshed glTF 2.0 (.glb) and Wavefront (.obj + .mtl) exporters.
// Converts Le'Vox voxel stacks & scenes into portable meshes ready for Blender, Godot, and Unreal.
(function (global) {
  'use strict';

  function srgbToLinear(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  // Convert Le'Vox (x, y, z) -> glTF Y-up right-handed (x, z, -y)
  function toGltfVec(x, y, z, yUp) {
    return yUp ? [x, z, -y] : [x, y, z];
  }

  // Exact 3x3 similarity transform M * R_lv * M^T -> glTF quaternion [x, y, z, w]
  function eulerToGltfQuat(yaw, pitch, roll, yUp) {
    const cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
    const cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
    const cr = Math.cos(roll || 0), sr = Math.sin(roll || 0);

    // R_lv = Rz(yaw) * Ry(pitch) * Rx(roll)
    const r00 = cy * cp, r01 = cy * sp * sr - sy * cr, r02 = cy * sp * cr + sy * sr;
    const r10 = sy * cp, r11 = sy * sp * sr + cy * cr, r12 = sy * sp * cr - cy * sr;
    const r20 = -sp,     r21 = cp * sr,                r22 = cp * cr;

    // If not yUp, convert R_lv directly; if yUp, M = [[1,0,0],[0,0,1],[0,-1,0]] -> M*R*M^T
    const m00 = r00, m01 = yUp ? r02 : r01, m02 = yUp ? -r01 : r02;
    const m10 = yUp ? r20 : r10, m11 = yUp ? r22 : r11, m12 = yUp ? -r21 : r12;
    const m20 = yUp ? -r10 : r20, m21 = yUp ? -r12 : r21, m22 = yUp ? r11 : r22;

    const tr = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1.0) * 2;
      qw = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
      qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
      qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
      qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s;
    }
    return [qx, qy, qz, qw];
  }

  // Greedy mesh an Art stack into per-material triangle buckets (with CCW outer winding).
  function meshFromStack(stack, pal, opts) {
    const o = opts || {};
    const yUp = o.yUp !== false;
    const voxelSize = o.voxelSize ?? 0.1;
    const centerXY = o.centerXY !== false;
    const pad = stack.pad || 0;
    const gw = stack.w + pad * 2;
    const gh = stack.h + pad * 2;
    const gn = stack.n;
    const wh = gw * gh;
    const vox = stack.vox;
    if (!vox) throw new Error('Stack has no voxel grid');

    const ox = centerXY ? -gw * 0.5 : 0;
    const oy = centerXY ? -gh * 0.5 : 0;
    const oz = o.centerZ ? -gn * 0.5 : 0;

    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= gw || y >= gh || z >= gn) ? 0 : vox[z * wh + y * gw + x];

    // Buckets keyed by material id (1..255)
    const buckets = new Map();
    const getBucket = (matId) => {
      let b = buckets.get(matId);
      if (!b) {
        b = { matId, pos: [], norm: [], idx: [], vertCount: 0 };
        buckets.set(matId, b);
      }
      return b;
    };

    const addQuad = (matId, p0, p1, p2, p3, nrm) => {
      const b = getBucket(matId);
      const base = b.vertCount;
      const g0 = toGltfVec((p0[0] + ox) * voxelSize, (p0[1] + oy) * voxelSize, (p0[2] + oz) * voxelSize, yUp);
      const g1 = toGltfVec((p1[0] + ox) * voxelSize, (p1[1] + oy) * voxelSize, (p1[2] + oz) * voxelSize, yUp);
      const g2 = toGltfVec((p2[0] + ox) * voxelSize, (p2[1] + oy) * voxelSize, (p2[2] + oz) * voxelSize, yUp);
      const g3 = toGltfVec((p3[0] + ox) * voxelSize, (p3[1] + oy) * voxelSize, (p3[2] + oz) * voxelSize, yUp);
      const gnrm = toGltfVec(nrm[0], nrm[1], nrm[2], yUp);

      b.pos.push(g0[0], g0[1], g0[2], g1[0], g1[1], g1[2], g2[0], g2[1], g2[2], g3[0], g3[1], g3[2]);
      for (let k = 0; k < 4; k++) b.norm.push(gnrm[0], gnrm[1], gnrm[2]);
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      b.vertCount += 4;
    };

    // 6 axis-aligned directions: [axis(0=x,1=y,2=z), step(+1/-1), uAxis, vAxis, uSize, vSize, sSize]
    const DIRS = [
      { ax: 0, dir: 1,  u: 1, v: 2, nu: gh, nv: gn, ns: gw, nrm: [1, 0, 0] },
      { ax: 0, dir: -1, u: 1, v: 2, nu: gh, nv: gn, ns: gw, nrm: [-1, 0, 0] },
      { ax: 1, dir: 1,  u: 0, v: 2, nu: gw, nv: gn, ns: gh, nrm: [0, 1, 0] },
      { ax: 1, dir: -1, u: 0, v: 2, nu: gw, nv: gn, ns: gh, nrm: [0, -1, 0] },
      { ax: 2, dir: 1,  u: 0, v: 1, nu: gw, nv: gh, ns: gn, nrm: [0, 0, 1] },
      { ax: 2, dir: -1, u: 0, v: 1, nu: gw, nv: gh, ns: gn, nrm: [0, 0, -1] },
    ];

    const c = [0, 0, 0];
    for (const D of DIRS) {
      const mask = new Uint16Array(D.nu * D.nv);
      for (let s = 0; s < D.ns; s++) {
        // Fill 2D visibility mask for this slice
        for (let v = 0; v < D.nv; v++) {
          for (let u = 0; u < D.nu; u++) {
            c[D.ax] = s; c[D.u] = u; c[D.v] = v;
            const id = at(c[0], c[1], c[2]);
            if (!id) { mask[v * D.nu + u] = 0; continue; }
            c[D.ax] = s + D.dir;
            const nb = at(c[0], c[1], c[2]);
            mask[v * D.nu + u] = nb ? 0 : id;
          }
        }
        // Greedy merge rectangles of identical materialId
        for (let v = 0; v < D.nv; v++) {
          for (let u = 0; u < D.nu; ) {
            const mat = mask[v * D.nu + u];
            if (!mat) { u++; continue; }
            let w = 1;
            while (u + w < D.nu && mask[v * D.nu + u + w] === mat) w++;
            let h = 1;
            outer: while (v + h < D.nv) {
              for (let k = 0; k < w; k++) {
                if (mask[(v + h) * D.nu + u + k] !== mat) break outer;
              }
              h++;
            }
            for (let dv = 0; dv < h; dv++) {
              for (let du = 0; du < w; du++) mask[(v + dv) * D.nu + u + du] = 0;
            }

            const plane = s + (D.dir > 0 ? 1 : 0);
            const makePt = (uu, vv) => {
              const p = [0, 0, 0];
              p[D.ax] = plane; p[D.u] = uu; p[D.v] = vv;
              return p;
            };
            // Orient quad CCW from outside
            if (D.ax === 0) {
              if (D.dir > 0) addQuad(mat, makePt(u, v), makePt(u + w, v), makePt(u + w, v + h), makePt(u, v + h), D.nrm);
              else           addQuad(mat, makePt(u + w, v), makePt(u, v), makePt(u, v + h), makePt(u + w, v + h), D.nrm);
            } else if (D.ax === 1) {
              if (D.dir > 0) addQuad(mat, makePt(u + w, v), makePt(u, v), makePt(u, v + h), makePt(u + w, v + h), D.nrm);
              else           addQuad(mat, makePt(u, v), makePt(u + w, v), makePt(u + w, v + h), makePt(u, v + h), D.nrm);
            } else {
              if (D.dir > 0) addQuad(mat, makePt(u, v), makePt(u + w, v), makePt(u + w, v + h), makePt(u, v + h), D.nrm);
              else           addQuad(mat, makePt(u, v + h), makePt(u + w, v + h), makePt(u + w, v), makePt(u, v), D.nrm);
            }
            u += w;
          }
        }
      }
    }

    let totalQuads = 0, totalTris = 0;
    for (const b of buckets.values()) {
      totalQuads += b.vertCount / 4;
      totalTris += b.idx.length / 3;
    }
    return { buckets, totalQuads, totalTris };
  }

  function reverseMatNames(pal) {
    const rev = {};
    if (pal && pal.names) {
      Object.keys(pal.names).forEach((k) => { rev[pal.names[k]] = k; });
    }
    return rev;
  }

  // Export one Stack or a list of placed items [{ name, stack, x, y, z, rot, pitch, roll, scale }] to a .glb Uint8Array
  function toGLB(stackOrItems, pal, opts) {
    const o = opts || {};
    const yUp = o.yUp !== false;
    const voxelSize = o.voxelSize ?? 0.1;
    const items = Array.isArray(stackOrItems)
      ? stackOrItems
      : [{ name: stackOrItems.name || 'stack', stack: stackOrItems, x: 0, y: 0, z: 0, rot: 0, pitch: 0, roll: 0, scale: 1 }];

    const revNames = reverseMatNames(pal);
    const gltfMaterials = [];
    const gltfMatByPalId = new Map();

    const ensureGltfMat = (palId) => {
      if (gltfMatByPalId.has(palId)) return gltfMatByPalId.get(palId);
      const rgba = (pal && pal.rgba && pal.rgba[palId]) || [200, 200, 200, 0];
      const r = srgbToLinear(rgba[0]), g = srgbToLinear(rgba[1]), b = srgbToLinear(rgba[2]);
      const glow = (rgba[3] || 0) / 255;
      const mat = {
        name: revNames[palId] || ('mat_' + palId),
        pbrMetallicRoughness: {
          baseColorFactor: [r, g, b, 1.0],
          metallicFactor: 0.05,
          roughnessFactor: 0.85
        }
      };
      if (glow > 0.01) {
        const em = glow * 2.0;
        mat.emissiveFactor = [Math.min(1, r * em), Math.min(1, g * em), Math.min(1, b * em)];
      }
      const idx = gltfMaterials.length;
      gltfMaterials.push(mat);
      gltfMatByPalId.set(palId, idx);
      return idx;
    };

    const binChunks = [];
    let binLen = 0;
    const bufferViews = [];
    const accessors = [];

    const appendBytes = (typedArr, target) => {
      const raw = new Uint8Array(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength);
      const pad = (4 - (raw.byteLength % 4)) % 4;
      const viewIdx = bufferViews.length;
      bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: raw.byteLength, target });
      binChunks.push(raw);
      if (pad) binChunks.push(new Uint8Array(pad));
      binLen += raw.byteLength + pad;
      return viewIdx;
    };

    const meshCache = new Map();
    const gltfMeshes = [];
    const gltfNodes = [];

    const buildMeshForStack = (stack) => {
      if (meshCache.has(stack)) return meshCache.get(stack);
      const { buckets } = meshFromStack(stack, pal, { yUp, voxelSize, centerXY: true, centerZ: false });
      const primitives = [];

      for (const bucket of buckets.values()) {
        const posArr = new Float32Array(bucket.pos);
        const normArr = new Float32Array(bucket.norm);
        const useU32 = bucket.vertCount > 65535;
        const idxArr = useU32 ? new Uint32Array(bucket.idx) : new Uint16Array(bucket.idx);

        // Compute exact bounding box for POSITION accessor (required by glTF 2.0 spec)
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < posArr.length; i += 3) {
          const x = posArr[i], y = posArr[i + 1], z = posArr[i + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        const posView = appendBytes(posArr, 34962);
        const normView = appendBytes(normArr, 34962);
        const idxView = appendBytes(idxArr, 34963);

        const posAcc = accessors.length;
        accessors.push({ bufferView: posView, componentType: 5126, count: bucket.vertCount, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
        const normAcc = accessors.length;
        accessors.push({ bufferView: normView, componentType: 5126, count: bucket.vertCount, type: 'VEC3' });
        const idxAcc = accessors.length;
        accessors.push({ bufferView: idxView, componentType: useU32 ? 5125 : 5123, count: idxArr.length, type: 'SCALAR' });

        primitives.push({
          attributes: { POSITION: posAcc, NORMAL: normAcc },
          indices: idxAcc,
          material: ensureGltfMat(bucket.matId)
        });
      }

      const meshIdx = gltfMeshes.length;
      gltfMeshes.push({ name: stack.name || ('mesh_' + meshIdx), primitives });
      meshCache.set(stack, meshIdx);
      return meshIdx;
    };

    const sceneNodeIndices = [];
    items.forEach((it, idx) => {
      if (!it || !it.stack || !it.stack.vox) return;
      const meshIdx = buildMeshForStack(it.stack);
      const t = toGltfVec((it.x || 0) * voxelSize, (it.y || 0) * voxelSize, (it.z || 0) * voxelSize, yUp);
      const node = {
        name: it.name || it.id || (it.stack.name + '_' + idx),
        mesh: meshIdx,
        translation: t
      };
      if (it.rot || it.pitch || it.roll) {
        node.rotation = eulerToGltfQuat(it.rot || 0, it.pitch || 0, it.roll || 0, yUp);
      }
      const sc = it.scale ?? 1;
      if (sc !== 1) node.scale = [sc, sc, sc];
      sceneNodeIndices.push(gltfNodes.length);
      gltfNodes.push(node);
    });

    const jsonObj = {
      asset: { version: '2.0', generator: "Le'Vox Exporter" },
      scene: 0,
      scenes: [{ name: o.sceneName || 'LeVoxScene', nodes: sceneNodeIndices }],
      nodes: gltfNodes,
      meshes: gltfMeshes,
      materials: gltfMaterials,
      buffers: [{ byteLength: binLen }],
      bufferViews,
      accessors
    };

    const enc = new TextEncoder();
    const rawJson = enc.encode(JSON.stringify(jsonObj));
    const jsonPad = (4 - (rawJson.byteLength % 4)) % 4;
    const jsonLen = rawJson.byteLength + jsonPad;
    const totalLen = 12 + 8 + jsonLen + 8 + binLen;

    const out = new Uint8Array(totalLen);
    const dv = new DataView(out.buffer);
    // GLB Header: magic ('glTF'), version (2), total length
    dv.setUint32(0, 0x46546C67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, totalLen, true);
    // Chunk 0: JSON
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4E4F534A, true);
    out.set(rawJson, 20);
    for (let i = 0; i < jsonPad; i++) out[20 + rawJson.byteLength + i] = 0x20;
    // Chunk 1: BIN
    const binHdr = 20 + jsonLen;
    dv.setUint32(binHdr, binLen, true);
    dv.setUint32(binHdr + 4, 0x004E4942, true);
    let ptr = binHdr + 8;
    for (const c of binChunks) { out.set(c, ptr); ptr += c.byteLength; }

    return out;
  }

  // Export a mounted Studio instance (entities + optional ground) directly to .glb
  function studioToGLB(studio, opts) {
    const o = opts || {};
    const includeGround = !!o.includeGround;
    const spec = studio.spec;
    const items = [];

    spec.entities.forEach((e) => {
      const st = studio.stacks[e.asset];
      if (!st) return;
      if (!includeGround && st.def && st.def.ground) return;
      items.push({
        name: e.id || e.asset,
        stack: st,
        x: e.x, y: e.y, z: e.z,
        rot: e.rot || 0, pitch: e.pitch || 0, roll: e.roll || 0,
        scale: e.scale || 1
      });
    });

    if (includeGround) {
      Object.keys(studio.stacks).forEach((k) => {
        if (!k.startsWith('_ground_')) return;
        const parts = k.split('_');
        const tx = +parts[2], ty = +parts[3], ts = spec.world.tileSize || 48;
        items.push({ name: k, stack: studio.stacks[k], x: tx * ts + ts / 2, y: ty * ts + ts / 2, z: 0, rot: 0, scale: 1 });
      });
    }

    return toGLB(items, studio.palette, o);
  }

  // Export a single Stack to Wavefront OBJ + MTL text pair
  function toOBJ(stack, pal, opts) {
    const o = opts || {};
    const mtlName = o.mtlName || (stack.name || 'levox') + '.mtl';
    const { buckets } = meshFromStack(stack, pal, { yUp: o.yUp !== false, voxelSize: o.voxelSize ?? 0.1, centerXY: true });
    const revNames = reverseMatNames(pal);

    const objLines = ['# Le\'Vox Greedy-Meshed OBJ', 'mtllib ' + mtlName, 'o ' + (stack.name || 'stack')];
    const mtlLines = ['# Le\'Vox Material Library'];
    let vOff = 1, vnOff = 1;

    for (const bucket of buckets.values()) {
      const mName = revNames[bucket.matId] || ('mat_' + bucket.matId);
      const rgba = (pal && pal.rgba && pal.rgba[bucket.matId]) || [200, 200, 200, 0];
      const r = (rgba[0] / 255).toFixed(4), g = (rgba[1] / 255).toFixed(4), b = (rgba[2] / 255).toFixed(4);
      const glow = (rgba[3] || 0) / 255;

      mtlLines.push('newmtl ' + mName, `Kd ${r} ${g} ${b}`, 'Ka 0 0 0', 'Ks 0.05 0.05 0.05');
      if (glow > 0.01) mtlLines.push(`Ke ${(r * glow * 2).toFixed(4)} ${(g * glow * 2).toFixed(4)} ${(b * glow * 2).toFixed(4)}`);

      objLines.push('usemtl ' + mName);
      for (let i = 0; i < bucket.pos.length; i += 3) {
        objLines.push(`v ${bucket.pos[i].toFixed(4)} ${bucket.pos[i + 1].toFixed(4)} ${bucket.pos[i + 2].toFixed(4)}`);
      }
      for (let i = 0; i < bucket.norm.length; i += 3) {
        objLines.push(`vn ${bucket.norm[i].toFixed(2)} ${bucket.norm[i + 1].toFixed(2)} ${bucket.norm[i + 2].toFixed(2)}`);
      }
      for (let i = 0; i < bucket.idx.length; i += 3) {
        const a = bucket.idx[i] + vOff, b2 = bucket.idx[i + 1] + vOff, c = bucket.idx[i + 2] + vOff;
        const na = bucket.idx[i] + vnOff, nb = bucket.idx[i + 1] + vnOff, nc = bucket.idx[i + 2] + vnOff;
        objLines.push(`f ${a}//${na} ${b2}//${nb} ${c}//${nc}`);
      }
      vOff += bucket.vertCount;
      vnOff += bucket.vertCount;
    }

    return { obj: objLines.join('\n') + '\n', mtl: mtlLines.join('\n') + '\n' };
  }

  function downloadGLB(filename, target, palOrOpts, maybeOpts) {
    const isStudio = target && target.stacks && target.palette && target.spec;
    const bytes = isStudio ? studioToGLB(target, palOrOpts) : toGLB(target, palOrOpts, maybeOpts);
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'levox-export.glb';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return bytes;
  }

  global.Exporters = { meshFromStack, toGLB, studioToGLB, toOBJ, downloadGLB };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- core/engine.js ---
// core/engine.js: Evolved WebGL2 Sprite-Stack & Voxel Renderer.
// Upgrades over upstream sprite-stack-engine:
//  - True per-instance 3D rotation (yaw/rot, pitch, roll) in both Slice & Voxel modes
//  - Integrated single-pass Bayer 4x4 dithering, OKLab palette quantization & 1px outline in FS_POST
//  - 32 distance-culled dynamic point lamps & configurable shadowSteps / aoSamples
//  - Built-in screenToWorld() raycaster and clean destroy() lifecycle
(function (global) {
  'use strict';

  const HMAX = 128;
  const LAMPS = 32;
  const BLOBS = 32;
  const FL = 16;      // floats per slice/voxel instance
  const IL = 15;      // floats per impostor instance
  const NB = 256;
  const ZQ = 2;
  const ANGLES = 32;
  const IMP_PPU = 4;
  const IMP_W = 2048;
  const IMP_H = 1024;

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mul(A, B) {
    const M = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      M[c * 4 + r] = A[r] * B[c * 4] + A[4 + r] * B[c * 4 + 1] + A[8 + r] * B[c * 4 + 2] + A[12 + r] * B[c * 4 + 3];
    }
    return M;
  }
  function invert(M) {
    const o = new Float32Array(16);
    const a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7];
    const i = M[8], j = M[9], k = M[10], l = M[11], m = M[12], n = M[13], p = M[14], q = M[15];
    const A = k * q - l * p, B = j * q - l * n, C = j * p - k * n, D = i * q - l * m, E = i * p - k * m, F = i * n - j * m;
    const G = g * q - h * p, H = f * q - h * n, I = f * p - g * n, J = e * q - h * m, K = e * p - g * m, L = e * n - f * m;
    const N = g * l - h * k, O = f * l - h * j, P = f * k - g * j, Q = e * l - h * i, R = e * k - g * i, S = e * j - f * i;
    o[0] = f * A - g * B + h * C; o[4] = -(e * A - g * D + h * E); o[8] = e * B - f * D + h * F; o[12] = -(e * C - f * E + g * F);
    o[1] = -(b * A - c * B + d * C); o[5] = a * A - c * D + d * E; o[9] = -(a * B - b * D + d * F); o[13] = a * C - b * E + c * F;
    o[2] = b * G - c * H + d * I; o[6] = -(a * G - c * J + d * K); o[10] = a * H - b * J + d * L; o[14] = -(a * I - b * K + c * L);
    o[3] = -(b * N - c * O + d * P); o[7] = a * N - c * Q + d * R; o[11] = -(a * O - b * Q + d * S); o[15] = a * P - b * R + c * S;
    const det = a * o[0] + b * o[4] + c * o[8] + d * o[12] || 1;
    for (let u = 0; u < 16; u++) o[u] /= det;
    return o;
  }

  function cameraMatrices(cam, aspect) {
    const ortho = cam.mode === 'ortho';
    const th = Math.tan((cam.fov || 38 * Math.PI / 180) * 0.5);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const back = [cp * cy, cp * sy, sp];
    const eye = [cam.tx + back[0] * cam.dist, cam.ty + back[1] * cam.dist, (cam.tz || 0) + back[2] * cam.dist];
    const f = norm([-back[0], -back[1], -back[2]]), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
    const V = new Float32Array([
      r[0], u[0], -f[0], 0,
      r[1], u[1], -f[1], 0,
      r[2], u[2], -f[2], 0,
      -dot(r, eye), -dot(u, eye), dot(f, eye), 1
    ]);
    let P;
    if (ortho) {
      const hh = cam.dist * th, hw = hh * aspect, n = 1, fr = 3200;
      P = new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (fr - n), 0, 0, 0, -(fr + n) / (fr - n), 1]);
    } else {
      const n = Math.max(2, cam.dist * 0.05), fr = cam.dist * 3 + 1400;
      P = new Float32Array([1 / (th * aspect), 0, 0, 0, 0, 1 / th, 0, 0, 0, 0, -(fr + n) / (fr - n), -1, 0, 0, -2 * fr * n / (fr - n), 0]);
    }
    const vp = mul(P, V);
    return { vp, inv: invert(vp), eye, f, r, u, ortho, th, cp, px: P[0], py: P[5], back };
  }

  function unproject(ndcX, ndcY, ndcZ, inv) {
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * ndcZ + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * ndcZ + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * ndcZ + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * ndcZ + inv[15] || 1;
    return [x / w, y / w, z / w];
  }

  function screenToWorld(cam, aspect, ndcX, ndcY, planeZ = 0) {
    const M = cameraMatrices(cam, aspect);
    const p0 = unproject(ndcX, ndcY, -1, M.inv);
    const p1 = unproject(ndcX, ndcY, 1, M.inv);
    const dz = p1[2] - p0[2];
    const t = Math.abs(dz) > 1e-5 ? (planeZ - p0[2]) / dz : 0.5;
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, planeZ];
  }

  // ---------------------------------------------------------------- Shaders
  const ROT_MAT_GLSL = `
  mat3 rotMat(float yaw, float pitch, float roll) {
    float cy = cos(yaw), sy = sin(yaw);
    float cp = cos(pitch), sp = sin(pitch);
    float cr = cos(roll), sr = sin(roll);
    return mat3(
      cy * cp,              sy * cp,              -sp,
      cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr,
      cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr
    );
  }`;

  const VS_SLICE = `#version 300 es
  layout(location=0) in vec3 a_pos;      // pivot x, y, z
  layout(location=1) in vec4 a_angles;   // yaw, pitch, roll, localZ
  layout(location=2) in vec4 a_rect;
  layout(location=3) in vec2 a_off;
  layout(location=4) in float a_scale;
  layout(location=5) in vec2 a_corner;
  uniform mat4 u_vp; uniform float u_guard;
  out vec2 v_uv; flat out vec4 v_rect; flat out mat3 v_rotM; out float v_h;
  ${ROT_MAT_GLSL}
  void main() {
    mat3 R = rotMat(a_angles.x, a_angles.y, a_angles.z);
    vec2 l = (a_off + (a_corner - 0.5) * a_rect.zw) * a_scale;
    vec2 m = a_off * a_scale;
    vec3 w = a_pos + R * vec3(l, a_angles.w);
    vec3 wMid = a_pos + R * vec3(m, a_angles.w);
    vec4 p = u_vp * vec4(w, 1.0);
    vec4 q = u_vp * vec4(wMid, 1.0);
    p.y += (p.y / p.w >= q.y / q.w ? 1.0 : -1.0) * u_guard * p.w;
    gl_Position = p;
    v_uv = a_rect.xy + a_corner * a_rect.zw;
    v_rect = a_rect;
    v_rotM = R;
    v_h = w.z;
  }`;

  const FS_G = `#version 300 es
  precision highp float;
  uniform sampler2D u_atlas;
  in vec2 v_uv; flat in vec4 v_rect; flat in mat3 v_rotM; in float v_h;
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 t = texelFetch(u_atlas, ivec2(clamp(v_uv, v_rect.xy, v_rect.xy + v_rect.zw - 0.001)), 0);
    if (t.r == 0.0) discard;
    vec3 n = normalize(v_rotM * (t.gba * 2.0 - 1.0));
    o0 = vec4(t.r, n * 0.5 + 0.5);
    float h = clamp(v_h / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, 0.0, 0.0);
  }`;

  const FS_COUNT = `#version 300 es
  precision highp float;
  uniform sampler2D u_atlas; uniform int u_all; uniform float u_unit;
  in vec2 v_uv; flat in vec4 v_rect; flat in mat3 v_rotM; in float v_h;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); return; }
    vec4 t = texelFetch(u_atlas, ivec2(clamp(v_uv, v_rect.xy, v_rect.xy + v_rect.zw - 0.001)), 0);
    if (t.r == 0.0) discard;
    o = vec4(u_unit, 0.0, 0.0, 0.0);
  }`;

  // Voxel Mode with full 3D local-frame ray walk
  const VS_VOXEL = `#version 300 es
  layout(location=0) in vec3 a_pos;      // pivot x, y, z
  layout(location=1) in vec4 a_angles;   // yaw, pitch, roll, localZ
  layout(location=2) in vec4 a_rect;
  layout(location=3) in vec2 a_off;
  layout(location=4) in float a_scale;
  layout(location=5) in vec3 a_box;
  layout(location=6) in float a_span;
  uniform mat4 u_vp; uniform vec3 u_eye, u_fwd; uniform float u_ortho;
  out vec3 v_p, v_d;
  flat out vec4 v_rect, v_base;
  flat out mat3 v_rotM;
  flat out vec2 v_off, v_zinfo;          // localZ, a_span / a_scale
  ${ROT_MAT_GLSL}
  void main() {
    mat3 R = rotMat(a_angles.x, a_angles.y, a_angles.z);
    vec2 l = (a_off + (a_box.xy - 0.5) * a_rect.zw) * a_scale;
    vec3 localW = vec3(l, a_angles.w + a_box.z * a_span);
    vec3 w = a_pos + R * localW;
    gl_Position = u_vp * vec4(w, 1.0);
    v_p = vec3(a_box.xy * a_rect.zw, a_box.z * a_span / a_scale);
    vec3 d = u_ortho > 0.5 ? u_fwd : w - u_eye;
    v_d = transpose(R) * d;
    v_rect = a_rect;
    v_base = vec4(a_pos, a_scale);
    v_rotM = R;
    v_off = a_off;
    v_zinfo = vec2(a_angles.w, a_span / a_scale);
  }`;

  const WALK = `
  uniform sampler2D u_atlas; uniform mat4 u_vp;
  in vec3 v_p, v_d;
  flat in vec4 v_rect, v_base;
  flat in mat3 v_rotM;
  flat in vec2 v_off, v_zinfo;
  bool walk(out vec4 t, out vec3 q) {
    vec3 dir = normalize(v_d); vec2 size = v_rect.zw;
    vec3 p = vec3(clamp(v_p.xy, vec2(0.001), size - 0.001), v_p.z);
    ivec2 cell = ivec2(p.xy), lim = ivec2(size + 0.5), stp = ivec2(dir.x < 0.0 ? -1 : 1, dir.y < 0.0 ? -1 : 1);
    vec2 inv = 1.0 / max(abs(dir.xy), vec2(0.00001));
    vec2 next = vec2(dir.x < 0.0 ? p.x - float(cell.x) : float(cell.x) + 1.0 - p.x, dir.y < 0.0 ? p.y - float(cell.y) : float(cell.y) + 1.0 - p.y) * inv;
    float leave = dir.z < -0.00001 ? p.z / -dir.z : dir.z > 0.00001 ? (v_zinfo.y - p.z) / dir.z : 1000000.0, k = 0.0; bool hit = false;
    for (int i = 0; i < 48; i++) {
      t = texelFetch(u_atlas, ivec2(v_rect.xy) + cell, 0);
      if (t.r > 0.0) { hit = true; break; }
      if (next.x < next.y) { k = next.x; next.x += inv.x; cell.x += stp.x; } else { k = next.y; next.y += inv.y; cell.y += stp.y; }
      if (k > leave || cell.x < 0 || cell.y < 0 || cell.x >= lim.x || cell.y >= lim.y) break;
    }
    q = p + dir * k; return hit;
  }
  vec3 worldHit(vec3 q) {
    vec2 l = (v_off + q.xy - v_rect.zw * 0.5) * v_base.w;
    vec3 localPos = vec3(l, v_zinfo.x + clamp(q.z, 0.0, v_zinfo.y) * v_base.w);
    return v_base.xyz + v_rotM * localPos;
  }
  float depthOf(vec3 q, out vec3 wPos) {
    wPos = worldHit(q);
    vec4 c = u_vp * vec4(wPos, 1.0);
    return c.z / c.w * 0.5 + 0.5;
  }`;

  const FS_GVOXEL = `#version 300 es
  precision highp float;
  ${WALK}
  uniform vec3 u_eye, u_fwd;
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 t; vec3 q; if (!walk(t, q)) discard;
    vec3 n = normalize(v_rotM * (t.gba * 2.0 - 1.0));
    vec3 wPos; gl_FragDepth = depthOf(q, wPos);
    o0 = vec4(t.r, n * 0.5 + 0.5);
    float h = clamp(wPos.z / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    float far = clamp(dot(wPos - u_eye, u_fwd) / 4096.0, 0.0, 1.0) * 65535.0, fi = floor(far / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, fi / 255.0, (far - fi * 256.0) / 255.0);
  }`;

  const FS_COUNTVOXEL = `#version 300 es
  precision highp float;
  ${WALK}
  uniform int u_all; uniform float u_unit;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); gl_FragDepth = gl_FragCoord.z; return; }
    vec4 t; vec3 q; if (!walk(t, q)) discard;
    vec3 wPos; gl_FragDepth = depthOf(q, wPos);
    o = vec4(u_unit, 0.0, 0.0, 0.0);
  }`;

  const VS_IMP = `#version 300 es
  layout(location=0) in vec4 a_pos;
  layout(location=1) in vec4 a_cell;
  layout(location=2) in vec4 a_how;
  layout(location=3) in vec3 a_size;
  layout(location=5) in vec2 a_corner;
  uniform mat4 u_vp; uniform vec3 u_right, u_up;
  out vec2 v_uv; out vec3 v_w; flat out vec4 v_cell, v_pos; flat out float v_rot;
  void main() {
    vec3 w = a_pos.xyz + (u_right * ((a_corner.x - 0.5) * a_size.x) + u_up * (a_corner.y * a_size.y - a_size.z)) * a_pos.w
           + vec3(a_how.yz, 0.0) * (a_corner.y * a_how.w * a_pos.w);
    gl_Position = u_vp * vec4(w, 1.0); v_uv = a_corner * a_cell.zw; v_w = w; v_cell = a_cell; v_pos = a_pos; v_rot = a_how.x;
  }`;

  const IMP_FS = `
  uniform sampler2D u_i0, u_i1; uniform mat4 u_vp; uniform vec3 u_fwd;
  in vec2 v_uv; in vec3 v_w; flat in vec4 v_cell, v_pos; flat in float v_rot;
  bool sprite(out vec4 a, out float h) {
    ivec2 tc = ivec2(v_cell.xy) + ivec2(clamp(v_uv, vec2(0.0), v_cell.zw - 0.001));
    a = texelFetch(u_i0, tc, 0); if (a.r == 0.0) return false;
    vec4 b = texelFetch(u_i1, tc, 0);
    h = v_pos.z + (b.r * 65280.0 + b.g * 255.0) / 65535.0 * ${HMAX}.0 * v_pos.w;
    vec4 c = u_vp * vec4(v_w + u_fwd * ((v_w.z - h) / -u_fwd.z), 1.0);
    gl_FragDepth = c.z / c.w * 0.5 + 0.5; return true;
  }`;

  const FS_GIMP = `#version 300 es
  precision highp float;
  ${IMP_FS}
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 a; float hw; if (!sprite(a, hw)) discard;
    float c = cos(v_rot), s = sin(v_rot); vec3 n = a.gba * 2.0 - 1.0; n.xy = vec2(n.x * c - n.y * s, n.x * s + n.y * c);
    o0 = vec4(a.r, n * 0.5 + 0.5);
    float h = clamp(hw / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, 0.0, 1.0);
  }`;

  const FS_COUNTIMP = `#version 300 es
  precision highp float;
  ${IMP_FS}
  uniform int u_all; uniform float u_unit;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); gl_FragDepth = gl_FragCoord.z; return; }
    vec4 a; float hw; if (!sprite(a, hw)) discard;
    o = vec4(u_unit, 0.0, 0.0, 0.0);
  }`;

  const VS_FULL = `#version 300 es
  layout(location=5) in vec2 a_corner;
  out vec2 v_uv;
  void main() { v_uv = a_corner; gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;

  const FS_LIGHT = `#version 300 es
  precision highp float;
  uniform sampler2D u_g0, u_g1, u_pal, u_hm;
  uniform mat4 u_inv;
  uniform vec3 u_sun, u_sunCol, u_skyCol, u_bounceCol, u_hazeCol, u_outer, u_eye, u_fwd;
  uniform vec4 u_world, u_fx, u_view, u_tone;
  uniform float u_water;
  uniform int u_shadowSteps, u_aoSamples, u_nlamp, u_nblob;
  uniform vec4 u_lamp[${LAMPS}]; uniform vec3 u_lampCol[${LAMPS}];
  uniform vec4 u_blob[${BLOBS}]; uniform float u_blobLow[${BLOBS}];
  in vec2 v_uv; out vec4 o;

  float land(vec2 p) { return textureLod(u_hm, p / u_world.xy, 0.0).r * 127.5; }
  float height(ivec2 px) { vec4 g = texelFetch(u_g1, clamp(px, ivec2(0), textureSize(u_g1, 0) - 1), 0); return (g.r * 65280.0 + g.g * 255.0) / 65535.0 * ${HMAX}.0; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  vec3 beyond(vec2 p) {
    vec2 w = (p + 40.0 * vec2(vnoise(p * 0.009), vnoise(p * 0.009 + 7.3))) / 118.0, c = floor(w), f = fract(w);
    float k = hash(c), e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 118.0;
    vec3 col = u_outer * (k < 0.45 ? vec3(1.0) : k < 0.68 ? vec3(1.28, 1.1, 0.8) : k < 0.84 ? vec3(1.06, 0.84, 0.7) : vec3(0.9, 0.97, 0.85));
    return mix(u_outer * 0.7, col, smoothstep(1.0, 3.2, e)) * (0.9 + 0.2 * vnoise(p * 0.11));
  }
  vec3 finish(vec3 c) {
    c = 1.0 - exp(-pow(max(c * u_tone.x, 0.0), vec3(1.25)) * 1.7);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.16);
    c += vec3(0.022, 0.006, -0.022) * smoothstep(0.4, 1.0, l) + vec3(-0.014, 0.0, 0.022) * (1.0 - smoothstep(0.0, 0.45, l));
    return clamp(c, 0.0, 1.0);
  }
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    vec4 g0 = texelFetch(u_g0, px, 0);
    bool outer = g0.r == 0.0;
    float h = outer ? u_world.z : height(px);
    vec2 ndc = v_uv * 2.0 - 1.0; vec4 a = u_inv * vec4(ndc, -1.0, 1.0), b = u_inv * vec4(ndc, 1.0, 1.0); a /= a.w; b /= b.w;
    float fall = b.z - a.z; bool level = fall > -0.0001;
    if (outer && (level || (h - a.z) / fall > 1.0)) { o = vec4(finish(mix(u_hazeCol, u_hazeCol * 0.86 + u_skyCol * 0.3, clamp(normalize(b.xyz - a.xyz).z * 4.0, 0.0, 1.0))), 0.0); return; }
    vec3 w; float far = 0.0;
    if (!outer) { vec4 g1 = texelFetch(u_g1, px, 0); far = (g1.b * 65280.0 + g1.a * 255.0) / 65535.0 * 4096.0; }
    if (far > 0.001) { vec3 dir = normalize(b.xyz - a.xyz); w = u_eye + dir * (far / max(0.001, dot(dir, u_fwd))); }
    else w = a.xyz + (b.xyz - a.xyz) * (level ? 0.0 : (h - a.z) / fall);
    vec3 n = outer ? vec3(0.0, 0.0, 1.0) : normalize(g0.gba * 2.0 - 1.0);
    vec4 mat = outer ? vec4(beyond(w.xy), 0.0) : texelFetch(u_pal, ivec2(int(g0.r * 255.0 + 0.5), 0), 0);
    bool wet = !outer && abs(g0.r * 255.0 - u_water) < 1.5;
    if (wet) {
      float t = u_world.w;
      n = normalize(vec3(sin(w.x * 0.35 + w.y * 0.14 + t * 2.2) * 0.09 + cos(w.x * 0.18 - w.y * 0.31 + t * 1.6) * 0.07,
                         cos(w.y * 0.32 - w.x * 0.13 + t * 2.0) * 0.09, 1.0));
    }

    float sh = 1.0;
    if (u_fx.x > 0.0 && u_shadowSteps > 0) {
      float jit = 0.78 + 0.44 * hash(vec2(px));
      float stepLen = 2.0 * (48.0 / float(u_shadowSteps));
      for (int i = 1; i <= 48; i++) {
        if (i > u_shadowSteps) break;
        float t = (float(i) - 0.5) * stepLen * jit;
        vec3 s = w + u_sun * t;
        if (s.x < 0.0 || s.y < 0.0 || s.x >= u_world.x || s.y >= u_world.y || s.z > 120.0) break;
        sh = min(sh, clamp((s.z - land(s.xy)) / (t * u_fx.x), 0.0, 1.0));
      }
      if (u_fx.w > 0.0) sh *= 1.0 - u_fx.w * smoothstep(0.45, 0.78, vnoise(w.xy * 0.011 + vec2(u_world.w * 0.04, u_world.w * 0.015)));
      if (u_sun.z > 0.02) for (int i = 0; i < ${BLOBS}; i++) {
        if (i >= u_nblob) break;
        vec4 c = u_blob[i];
        if (w.z < c.z - 0.2 && w.z > u_blobLow[i] - 0.5) {
          float d = length(w.xy - c.xy - u_sun.xy / max(0.25, u_sun.z) * max(0.0, c.z - w.z));
          sh = min(sh, smoothstep(c.w * 0.4, c.w * 1.2, d));
        }
      }
      sh = mix(0.25, 1.0, sh);
    }

    float occ = 1.0;
    if (u_fx.y > 0.0 && u_aoSamples > 0) {
      float oc = 0.0, ang = hash(vec2(px)) * 6.283;
      const vec2 dir8[8] = vec2[8](vec2(1.0, 0.0), vec2(0.707, 0.707), vec2(0.0, 1.0), vec2(-0.707, 0.707), vec2(-1.0, 0.0), vec2(-0.707, -0.707), vec2(0.0, -1.0), vec2(0.707, -0.707));
      float ca = cos(ang), sa = sin(ang);
      for (int i = 0; i < 8; i++) {
        vec2 d = vec2(dir8[i].x * ca - dir8[i].y * sa, dir8[i].x * sa + dir8[i].y * ca);
        oc += smoothstep(0.5, 4.0, land(w.xy + d * 2.2) - w.z) * 0.55;
        if (u_aoSamples > 8) oc += smoothstep(1.2, 10.0, land(w.xy + d * 6.0) - w.z) * 0.45;
      }
      occ = 1.0 - min(0.7, oc / 8.0 * u_fx.y);
      if (w.z <= u_world.z + 1.5) for (int i = 0; i < ${BLOBS}; i++) {
        if (i >= u_nblob) break;
        vec4 c = u_blob[i];
        if (w.z < c.z - 0.2 && w.z > u_blobLow[i] - 0.5) occ = min(occ, 0.45 + 0.55 * smoothstep(c.w * 0.2, c.w * 1.1, length(w.xy - c.xy)));
      }
    }

    float ndl = max(dot(n, u_sun), 0.0), sky = n.z * 0.5 + 0.5;
    vec3 lit = mat.rgb * (u_sunCol * ndl * sh + mix(u_bounceCol, u_skyCol, sky) * occ);
    float fres = pow(1.0 - max(dot(n, normalize(u_eye - w)), 0.0), 3.0);
    if (wet) {
      vec3 R = reflect(-normalize(u_eye - w), n);
      float gl = pow(max(dot(R, u_sun), 0.0), 48.0) * sh;
      lit += u_skyCol * (0.35 + 0.9 * fres) + u_sunCol * gl * 1.5;
    } else if (!outer && ndl > 0.15) {
      float rim = max(0.0, dot(n, normalize(u_sun * 0.6 + vec3(0.0, 0.0, 0.4)))) * smoothstep(h + 0.4, h + 1.6, height(px + ivec2(u_view.xy)));
      lit += u_sunCol * (rim * 0.22 * sh + fres * 0.14 * ndl * sh);
    }

    for (int i = 0; i < ${LAMPS}; i++) {
      if (i >= u_nlamp) break;
      vec4 lp = u_lamp[i]; if (lp.w <= 0.0) continue;
      vec3 d = lp.xyz - w; float d2 = dot(d, d);
      if (d2 < lp.w * lp.w) {
        float k = 1.0 - sqrt(d2) / lp.w;
        lit += mat.rgb * u_lampCol[i] * (k * k * (0.45 + 0.55 * max(dot(n, normalize(d)), 0.0)) * 2.2);
      }
    }

    float glow = mat.a > 0.95 ? 1.0 : mat.a * u_fx.z;
    lit += mat.rgb * glow * (mat.a > 0.95 ? 3.2 : 2.6);

    float dist = u_tone.z > 0.5 ? length(w - u_eye) : dot(w - u_eye, u_fwd);
    float fog = 1.0 - exp(-max(0.0, dist - u_view.z) / u_view.w * u_tone.y);
    lit = mix(lit, u_hazeCol * (0.78 + 0.22 * max(0.0, u_sun.z)), clamp(fog, 0.0, 0.85));
    o = vec4(finish(lit), glow * 0.55);
  }`;

  const FS_HEAT = `#version 300 es
  precision highp float;
  uniform sampler2D u_count; uniform int u_channel; uniform float u_unit;
  in vec2 v_uv; out vec4 o;
  void main() {
    vec4 v = texelFetch(u_count, ivec2(v_uv * vec2(textureSize(u_count, 0))), 0);
    float n = (u_channel == 0 ? v.r : v.g) / u_unit;
    if (n < 0.05) { o = vec4(0.05, 0.06, 0.09, 1.0); return; }
    float t = clamp(log2(n) / 7.0, 0.0, 1.0);
    vec3 c = t < 0.25 ? mix(vec3(0.08, 0.16, 0.45), vec3(0.06, 0.62, 0.68), t * 4.0)
           : t < 0.5  ? mix(vec3(0.06, 0.62, 0.68), vec3(0.95, 0.85, 0.2), (t - 0.25) * 4.0)
           : t < 0.75 ? mix(vec3(0.95, 0.85, 0.2), vec3(0.96, 0.35, 0.08), (t - 0.5) * 4.0)
           :            mix(vec3(0.96, 0.35, 0.08), vec3(1.0, 0.96, 0.98), (t - 0.75) * 4.0);
    o = vec4(c, 1.0);
  }`;

  const FS_BRIGHT = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; uniform vec2 u_px; in vec2 v_uv; out vec4 o;
  void main() {
    vec3 s = vec3(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec4 t = texture(u_tex, v_uv + vec2(float(x), float(y)) * u_px);
      s += t.rgb * (max(0.0, dot(t.rgb, vec3(0.21, 0.72, 0.07)) - 0.82) + t.a * 1.4);
    }
    o = vec4(s / 9.0, 1.0);
  }`;

  const FS_BLUR = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; uniform vec2 u_step; in vec2 v_uv; out vec4 o;
  void main() {
    o = texture(u_tex, v_uv) * 0.227 + (texture(u_tex, v_uv + u_step * 1.38) + texture(u_tex, v_uv - u_step * 1.38)) * 0.316
      + (texture(u_tex, v_uv + u_step * 3.23) + texture(u_tex, v_uv - u_step * 3.23)) * 0.070;
  }`;

  // Integrated final pass: Bloom + Vignette + Optional 1px Depth/Normal Outline + Bayer 4x4 + OKLab/Posterize
  const FS_POST = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex, u_bloom, u_g0, u_g1;
  uniform vec2 u_size, u_k;
  uniform vec4 u_dither;   // x: strength, y: levels, z: outline, w: palSize
  uniform vec3 u_pal[32];
  in vec2 v_uv; out vec4 o;

  float bayer4x4(vec2 px) {
    int x = int(mod(px.x, 4.0));
    int y = int(mod(px.y, 4.0));
    int i = y * 4 + x;
    float m[16] = float[16](
      0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
     12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
      3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
     15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
    );
    return m[i] - 0.5;
  }

  vec3 rgbToOklab(vec3 c) {
    c = pow(max(c, vec3(0.0)), vec3(2.2));
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    float l_ = pow(max(l, 0.0), 1.0 / 3.0);
    float m_ = pow(max(m, 0.0), 1.0 / 3.0);
    float s_ = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3(
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
  }

  float gHeight(ivec2 px) {
    ivec2 cpx = clamp(px, ivec2(0), ivec2(u_size) - 1);
    vec4 g = texelFetch(u_g1, cpx, 0);
    return (g.r * 65280.0 + g.g * 255.0) / 65535.0 * ${HMAX}.0;
  }

  void main() {
    ivec2 px = ivec2(floor(v_uv * u_size));
    vec3 c = texelFetch(u_tex, clamp(px, ivec2(0), ivec2(u_size) - 1), 0).rgb;
    vec3 b = texture(u_bloom, v_uv).rgb * u_k.x;
    c = 1.0 - (1.0 - c) * (1.0 - b);
    vec2 dv = v_uv - 0.5;
    c *= 1.0 - u_k.y * dot(dv, dv) * 1.6;

    // Optional 1px depth/normal silhouette outline at internal pixel resolution
    if (u_dither.z > 0.01) {
      vec4 g0c = texelFetch(u_g0, px, 0);
      if (g0c.r > 0.0) {
        float hc = gHeight(px);
        vec3 nc = normalize(g0c.gba * 2.0 - 1.0);
        float edge = 0.0;
        ivec2 offs[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
        for (int i = 0; i < 4; i++) {
          ivec2 np = clamp(px + offs[i], ivec2(0), ivec2(u_size) - 1);
          vec4 g0n = texelFetch(u_g0, np, 0);
          if (g0n.r == 0.0) edge = max(edge, 0.85);
          else {
            float hn = gHeight(np);
            if (hc - hn > 2.2) edge = max(edge, 0.85);
            vec3 nn = normalize(g0n.gba * 2.0 - 1.0);
            if (dot(nc, nn) < 0.3 && hc >= hn - 0.2) edge = max(edge, 0.45);
          }
        }
        c = mix(c, c * 0.28, edge * u_dither.z);
      }
    }

    // Optional Bayer 4x4 Dither + Quantization
    int palSize = int(u_dither.w + 0.5);
    float bayer = bayer4x4(vec2(px));
    if (palSize > 0) {
      vec3 dCol = clamp(c + vec3(bayer * u_dither.x * 0.14), 0.0, 1.0);
      vec3 lab = rgbToOklab(dCol);
      float bestDist = 1e9;
      vec3 best = dCol;
      for (int i = 0; i < 32; i++) {
        if (i >= palSize) break;
        vec3 diff = lab - rgbToOklab(u_pal[i]);
        float dist = diff.x * diff.x * 1.25 + diff.y * diff.y + diff.z * diff.z;
        if (dist < bestDist) { bestDist = dist; best = u_pal[i]; }
      }
      c = best;
    } else if (u_dither.y > 1.5 && u_dither.x > 0.001) {
      float stepSize = 1.0 / (u_dither.y - 1.0);
      vec3 dCol = clamp(c + vec3(bayer * stepSize * u_dither.x), 0.0, 1.0);
      c = floor(dCol * (u_dither.y - 1.0) + 0.5) / (u_dither.y - 1.0);
    }

    o = vec4(c, 1.0);
  }`;

  const PALETTES = {
    'Níveis (Posterize)': [],
    'Turbo Retro (24)': [
      '#10121c','#1d2030','#2d3145','#444d63','#697187','#9ea6bd',
      '#d6dce8','#f3efe2','#9c1f31','#d9383f','#ff594f','#ffbe47',
      '#ffe599','#7c4c48','#a36b5e','#3b6647','#5b9654','#2e729e',
      '#58b4de','#4ef2ff','#ff598f','#e09f3e','#356b9c','#f56a2c'
    ],
    'Endesga 16': [
      '#141013','#3b1725','#73172d','#b4202a','#df3e23','#fa6a0a',
      '#f9a31b','#ffd541','#fffc40','#d6f264','#9cdb43','#59c135',
      '#14a02e','#1a7a3e','#24523b','#122020'
    ],
    'Pico-8': [
      '#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f',
      '#c2c3c7','#fff1e8','#ff004d','#ffa300','#ffec27','#00e436',
      '#29adff','#83769c','#ff77a8','#ffccaa'
    ],
    'GameBoy Pocket': [
      '#0f1914','#243b2c','#486e4c','#7ca66c','#b8d492','#e8f5c8'
    ]
  };

  function hexToRgb01(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available');
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');

    const programs = [], textures = [], buffers = [], vaos = [], fbos = [], rbos = [];

    function program(vs, fs) {
      const p = gl.createProgram();
      [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach((s) => {
        const sh = gl.createShader(s[0]); gl.shaderSource(sh, s[1]); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
        gl.deleteShader(sh);
      });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
        u[name] = gl.getUniformLocation(p, name);
      }
      programs.push(p);
      return { p, u };
    }

    function texture(w, h, internal, format, type, data, filter) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(t);
      return t;
    }

    const pG = program(VS_SLICE, FS_G), pCount = program(VS_SLICE, FS_COUNT);
    const pLight = program(VS_FULL, FS_LIGHT), pHeat = program(VS_FULL, FS_HEAT);
    const pGVoxel = program(VS_VOXEL, FS_GVOXEL), pCountVoxel = program(VS_VOXEL, FS_COUNTVOXEL);
    const pGImp = program(VS_IMP, FS_GIMP), pCountImp = program(VS_IMP, FS_COUNTIMP);
    const pBright = program(VS_FULL, FS_BRIGHT), pBlur = program(VS_FULL, FS_BLUR), pPost = program(VS_FULL, FS_POST);

    const corners = gl.createBuffer(); buffers.push(corners);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    let cap = 1 << 16, inst = new Float32Array(cap * FL), tmp = new Float32Array(cap * FL), keys = new Uint16Array(cap);
    const counts = new Uint32Array(NB + 1);

    const vao = gl.createVertexArray(); vaos.push(vao);
    const buf = gl.createBuffer(); buffers.push(buf);
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const perInstance = (list) => list.forEach((a) => {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FL * 4, a[2] * 4);
      gl.vertexAttribDivisor(a[0], 1);
    });
    perInstance([[0, 3, 0], [1, 4, 3], [2, 4, 7], [3, 2, 11], [4, 1, 13]]);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

    const box = gl.createBuffer(); buffers.push(box);
    const vaoVoxel = gl.createVertexArray(); vaos.push(vaoVoxel);
    gl.bindVertexArray(vaoVoxel); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    perInstance([[0, 3, 0], [1, 4, 3], [2, 4, 7], [3, 2, 11], [4, 1, 13], [6, 1, 14]]);
    gl.bindBuffer(gl.ARRAY_BUFFER, box);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1,
      0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1,
      1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1,
      1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1,
      0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1,
      0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);

    const impBuf = gl.createBuffer(); buffers.push(impBuf);
    const vaoImp = gl.createVertexArray(); vaos.push(vaoImp);
    gl.bindVertexArray(vaoImp); gl.bindBuffer(gl.ARRAY_BUFFER, impBuf);
    [[0, 4, 0], [1, 4, 4], [2, 4, 8], [3, 3, 12]].forEach((a) => {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, IL * 4, a[2] * 4);
      gl.vertexAttribDivisor(a[0], 1);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

    const vaoFull = gl.createVertexArray(); vaos.push(vaoFull);
    gl.bindVertexArray(vaoFull); gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

    let iw = 0, ih = 0, bw = 0, bh = 0, g0, g1, lit, countTex, depth, fboG, fboLit, fboCount, bloom = [], fboBloom = [];
    function releaseTargets() {
      [g0, g1, lit, countTex, bloom[0], bloom[1]].forEach((t) => t && gl.deleteTexture(t));
      [fboG, fboLit, fboCount, fboBloom[0], fboBloom[1]].forEach((f) => f && gl.deleteFramebuffer(f));
      if (depth) gl.deleteRenderbuffer(depth);
    }

    function targets(w, h) {
      if (w === iw && h === ih) return;
      releaseTargets();
      iw = w; ih = h; bw = Math.max(1, w >> 2); bh = Math.max(1, h >> 2);
      g0 = gl.createTexture(); g1 = gl.createTexture(); lit = gl.createTexture(); countTex = gl.createTexture();
      const initTex = (t, tw, th, intFmt, fmt, tp, filt) => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, tw, th, 0, fmt, tp, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };
      initTex(g0, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      initTex(g1, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      initTex(lit, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      initTex(countTex, w, h, floatOK ? gl.RGBA16F : gl.RGBA8, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, gl.NEAREST);
      depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      fboG = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboG);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g1, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      fboLit = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lit, 0);
      fboCount = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboCount);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, countTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      for (let i = 0; i < 2; i++) {
        bloom[i] = gl.createTexture();
        initTex(bloom[i], bw, bh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
        fboBloom[i] = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboBloom[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloom[i], 0);
      }
    }

    const E = {
      gl,
      palettes: Object.keys(PALETTES),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      stats: { instances: 0, slices: 0, cpuMs: 0, gpuMs: null, written: null, covered: null, iw: 0, ih: 0 }
    };
    let palTex = null, hmTex = null, world = [1, 1], query = null, timing = false;
    const UNIT = floatOK ? 1 : 1 / 255;

    E.makeAtlas = (data, size) => texture(size, size, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
    E.setPalette = (bytes) => {
      if (palTex) gl.deleteTexture(palTex);
      palTex = texture(256, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    };
    E.setHeightMap = (bytes, w, h) => {
      if (hmTex) gl.deleteTexture(hmTex);
      hmTex = texture(w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bytes, gl.LINEAR);
      world = [w, h];
    };
    E.patchHeightMap = (bytes, x, y, w, h) => {
      gl.bindTexture(gl.TEXTURE_2D, hmTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, bytes);
    };

    const moved = { dx: 0, dy: 0, dz: 0, rot: 0, pitch: 0, roll: 0, scale: 1 };
    function build(list, M, opt) {
      const ppuOrtho = ih / (2 * opt.cam.dist * M.th), vp = M.vp, voxel = !!opt.voxel;
      let n = 0, slices = 0, tallest = 0;
      const slope = Math.tan(Math.max(0.06, M.ortho ? opt.cam.pitch : opt.cam.pitch - (opt.cam.fov || 0.66) * 0.35));

      for (let q = 0; q < list.length; q++) {
        const it = list[q], st = it.stack, sc = it.scale || 1, one = (it.only ?? -1) >= 0;
        const itPitch = it.pitch || 0, itRoll = it.roll || 0;
        const zc = one ? it.z : it.z + st.n * sc * 0.5;
        const R = (one ? st.radius : Math.hypot(st.radius, st.n * 0.5)) * sc + (it.each ? 60 : 2);
        const cw = vp[3] * it.x + vp[7] * it.y + vp[11] * zc + vp[15];
        const cx = vp[0] * it.x + vp[4] * it.y + vp[8] * zc + vp[12];
        const cy = vp[1] * it.x + vp[5] * it.y + vp[9] * zc + vp[13];
        if (!M.ortho && cw < -R) continue;
        if ((M.ortho || cw > R) && (Math.abs(cx) - R * M.px > cw || Math.abs(cy) - R * M.py > cw)) continue;

        const sides = one || st.slices.length > 1 || st.slices[0].sides;
        let rows = 1;
        if (opt.fill || opt.lod || voxel) {
          if (M.ortho) rows = ppuOrtho * M.cp * sc;
          else {
            const fov = opt.cam.fov || 38 * Math.PI / 180;
            const reach = (M.eye[2] - it.z - st.n * sc) / Math.sin(Math.min(1.5, opt.cam.pitch + fov / 2)) * Math.cos(fov / 2);
            const d = Math.max(4, reach, (it.x - M.eye[0]) * M.f[0] + (it.y - M.eye[1]) * M.f[1] + (it.z - M.eye[2]) * M.f[2] - st.radius * sc);
            rows = ih / (2 * d * M.th) * Math.min(1, M.cp + 0.25) * sc * 1.15;
          }
        }
        if (rows > tallest && sides && Math.abs(cx) < cw && Math.abs(cy) < cw) tallest = rows;

        const skip = opt.lod && !one && !it.each && rows < 1 ? Math.floor(1 / rows) : 1;
        const copies = voxel ? 1 : Math.max(st.shell ? Math.ceil(1 / (st.shell * slope)) : 1, Math.min(48, Math.ceil(opt.fill ? rows : 1)));
        const src = voxel && !one && !it.each ? st.runs : st.slices;
        const a = one ? it.only : 0, b = one ? it.only + 1 : src.length;
        const shx = it.shx || 0, shy = it.shy || 0;

        if (n + (b - a) * copies > cap) {
          while (n + (b - a) * copies > cap) cap *= 2;
          const i2 = new Float32Array(cap * FL), t2 = new Float32Array(cap * FL), k2 = new Uint16Array(cap);
          t2.set(tmp); k2.set(keys); inst = i2; tmp = t2; keys = k2;
        }

        for (let s = a; s < b; s++) {
          if (skip > 1 && (b - 1 - s) % skip) continue;
          const sl = src[s], first = sl.sides ? 0 : copies - 1;
          let px = it.x, py = it.y, pz = it.z;
          let localZ = one ? 0 : sl.z * sc;
          let rot = it.rot || 0, pitch = itPitch, roll = itRoll, k1 = sc;

          if (it.each) {
            moved.dx = 0; moved.dy = 0; moved.dz = 0; moved.rot = 0; moved.pitch = 0; moved.roll = 0; moved.scale = 1;
            const m = it.each(sl.z, st.n, moved);
            if (!m) continue;
            px += m.dx; py += m.dy; localZ += m.dz; rot += m.rot;
            if (m.pitch) pitch += m.pitch;
            if (m.roll) roll += m.roll;
            k1 *= m.scale;
          }
          slices++;

          if (voxel) {
            const j = n * FL, thin = !sl.sides, tall = thin ? 0.03 : s === b - 1 ? sl.n : Math.max(sl.n, skip);
            const lz = localZ + (thin ? (sl.n - 0.03) * k1 : 0);
            tmp[j] = px + shx * localZ; tmp[j + 1] = py + shy * localZ; tmp[j + 2] = pz;
            tmp[j + 3] = rot; tmp[j + 4] = pitch; tmp[j + 5] = roll; tmp[j + 6] = lz;
            tmp[j + 7] = sl.u; tmp[j + 8] = sl.v; tmp[j + 9] = sl.w; tmp[j + 10] = sl.h;
            tmp[j + 11] = sl.ox; tmp[j + 12] = sl.oy; tmp[j + 13] = k1; tmp[j + 14] = tall * k1; tmp[j + 15] = 0;
            keys[n++] = NB - 1 - Math.min(NB - 1, Math.max(0, Math.floor((pz + lz) * ZQ)));
            continue;
          }

          for (let k = first; k < copies; k++) {
            const lz = localZ + k / copies * k1, j = n * FL;
            tmp[j] = px + shx * lz; tmp[j + 1] = py + shy * lz; tmp[j + 2] = pz;
            tmp[j + 3] = rot; tmp[j + 4] = pitch; tmp[j + 5] = roll; tmp[j + 6] = lz;
            tmp[j + 7] = sl.u; tmp[j + 8] = sl.v; tmp[j + 9] = sl.w; tmp[j + 10] = sl.h;
            tmp[j + 11] = sl.ox; tmp[j + 12] = sl.oy; tmp[j + 13] = k1; tmp[j + 14] = 0; tmp[j + 15] = 0;
            let key = Math.min(NB - 1, Math.max(0, Math.floor((pz + lz) * ZQ)));
            if (opt.hsr) key = NB - 1 - key;
            keys[n++] = key;
          }
        }
      }

      counts.fill(0);
      for (let i = 0; i < n; i++) counts[keys[i] + 1]++;
      for (let i = 0; i < NB; i++) counts[i + 1] += counts[i];
      for (let i = 0; i < n; i++) {
        const d = counts[keys[i]]++ * FL, s = i * FL;
        for (let k = 0; k < FL; k++) inst[d + k] = tmp[s + k];
      }
      E.stats.instances = n; E.stats.slices = slices; E.stats.rows = tallest;
      return n;
    }

    function drawSlices(prog, n, M, opt, hsr) {
      gl.useProgram(prog.p); gl.uniformMatrix4fv(prog.u.u_vp, false, M.vp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opt.atlas); gl.uniform1i(prog.u.u_atlas, 0);
      if (hsr) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); } else gl.disable(gl.DEPTH_TEST);
      if (opt.voxel) {
        gl.bindVertexArray(vaoVoxel);
        gl.uniform3fv(prog.u.u_eye, M.eye); gl.uniform3fv(prog.u.u_fwd, M.f); gl.uniform1f(prog.u.u_ortho, M.ortho ? 1 : 0);
        gl.enable(gl.CULL_FACE); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, n); gl.disable(gl.CULL_FACE);
      } else {
        gl.bindVertexArray(vao);
        gl.uniform1f(prog.u.u_guard, opt.guard ? 1 / ih : 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      }
      gl.disable(gl.DEPTH_TEST);
    }

    function pass(fbo, w, h, prog, tex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
      gl.useProgram(prog.p); gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u.u_tex, 0);
    }

    const palBuf = new Float32Array(32 * 3);

    E.render = function (opt) {
      const t0 = performance.now(), W = canvas.width, H = canvas.height, env = opt.light;
      targets(Math.max(1, Math.round(W / (opt.scale || 1))), Math.max(1, Math.round(H / (opt.scale || 1))));
      const M = cameraMatrices(opt.cam, iw / ih), n = build(opt.list, M, opt);
      if (timerExt && !query) { query = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query); timing = true; }
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, n * FL), gl.DYNAMIC_DRAW);
      gl.viewport(0, 0, iw, ih); gl.disable(gl.BLEND);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboG);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const pg = opt.voxel ? pGVoxel : pG, tested = opt.hsr || !!opt.voxel;
      drawSlices(pg, n, M, opt, tested);

      // Light pass
      const u = pLight.u, sun = env.sun;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit); gl.useProgram(pLight.p); gl.bindVertexArray(vaoFull);
      [[g0, 'u_g0'], [g1, 'u_g1'], [palTex, 'u_pal'], [hmTex, 'u_hm']].forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t[0]); gl.uniform1i(u[t[1]], i);
      });
      gl.uniformMatrix4fv(u.u_inv, false, M.inv);
      gl.uniform3fv(u.u_sun, sun); gl.uniform3fv(u.u_sunCol, env.sunCol);
      gl.uniform3fv(u.u_skyCol, env.skyCol); gl.uniform3fv(u.u_bounceCol, env.bounceCol);
      gl.uniform3fv(u.u_hazeCol, env.hazeCol); gl.uniform3fv(u.u_outer, env.outer);
      gl.uniform3fv(u.u_eye, M.eye); gl.uniform3fv(u.u_fwd, M.f);
      gl.uniform4f(u.u_world, world[0], world[1], opt.ground || 0, opt.time || 0);
      gl.uniform4f(u.u_fx, opt.shadows ? 0.1 * sun[2] + 0.012 : 0, opt.ao ? 0.9 : 0, env.glow, opt.shadows ? env.cloud || 0 : 0);
      const sx = M.r[0] * sun[0] + M.r[1] * sun[1], sy = M.u[0] * sun[0] + M.u[1] * sun[1] + M.u[2] * sun[2], sl = Math.hypot(sx, sy) || 1;
      gl.uniform4f(u.u_view, sx / sl * 2, sy / sl * 2, M.back - 140, 760);
      gl.uniform4f(u.u_tone, env.exposure, env.hazeK, M.ortho ? 0 : 1, 0);
      gl.uniform1f(u.u_water, opt.water ?? -9);
      gl.uniform1i(u.u_shadowSteps, opt.shadowSteps ?? 32);
      gl.uniform1i(u.u_aoSamples, opt.aoSamples ?? 16);

      // Distance-cull & sort lamps when > LAMPS
      let lampSrc = opt.lamps || [];
      if (lampSrc.length > LAMPS) {
        const cx = opt.cam.tx || 0, cy = opt.cam.ty || 0, cz = opt.cam.tz || 0;
        lampSrc = lampSrc.slice().sort((a, b) =>
          ((a[0] - cx) ** 2 + (a[1] - cy) ** 2 + (a[2] - cz) ** 2) -
          ((b[0] - cx) ** 2 + (b[1] - cy) ** 2 + (b[2] - cz) ** 2)
        ).slice(0, LAMPS);
      }
      const lamps = new Float32Array(LAMPS * 4), lampCol = new Float32Array(LAMPS * 3);
      lampSrc.forEach((l, i) => { lamps.set(l.slice(0, 4), i * 4); lampCol.set(l.slice(4, 7), i * 3); });
      const blobSrc = (opt.blobs || []).slice(0, BLOBS);
      const blobs = new Float32Array(BLOBS * 4), low = new Float32Array(BLOBS);
      blobSrc.forEach((b, i) => { blobs.set(b.slice(0, 4), i * 4); low[i] = b[4]; });
      gl.uniform4fv(u.u_lamp, lamps); gl.uniform3fv(u.u_lampCol, lampCol);
      gl.uniform1i(u.u_nlamp, Math.min(LAMPS, lampSrc.length));
      gl.uniform4fv(u.u_blob, blobs); gl.uniform1fv(u.u_blobLow, low);
      gl.uniform1i(u.u_nblob, blobSrc.length);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (opt.bloom && !opt.heat) {
        pass(fboBloom[0], bw, bh, pBright, lit); gl.uniform2f(pBright.u.u_px, 1 / iw, 1 / ih); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [[1.2, 0], [0, 1.2], [2.6, 0], [0, 2.6]].forEach((s, i) => {
          pass(fboBloom[1 - (i & 1)], bw, bh, pBlur, bloom[i & 1]);
          gl.uniform2f(pBlur.u.u_step, s[0] / bw, s[1] / bh);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        });
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      if (opt.heat) {
        gl.activeTexture(gl.TEXTURE0); gl.useProgram(pHeat.p); gl.bindTexture(gl.TEXTURE_2D, countTex);
        gl.uniform1i(pHeat.u.u_count, 0); gl.uniform1i(pHeat.u.u_channel, opt.heat - 1); gl.uniform1f(pHeat.u.u_unit, UNIT);
      } else {
        gl.useProgram(pPost.p);
        [[lit, 'u_tex'], [bloom[0], 'u_bloom'], [g0, 'u_g0'], [g1, 'u_g1']].forEach((t, i) => {
          gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t[0]); gl.uniform1i(pPost.u[t[1]], i);
        });
        gl.uniform2f(pPost.u.u_size, iw, ih);
        gl.uniform2f(pPost.u.u_k, opt.bloom ? 0.55 + 0.75 * env.glow : 0, opt.vignette ?? 0.22);

        const dOpt = opt.dither || {};
        const dEnabled = !!dOpt.enabled;
        const dStrength = dEnabled ? (dOpt.strength ?? 0.6) : 0;
        const dLevels = dEnabled ? (dOpt.levels ?? 8) : 0;
        const dOutline = dOpt.outline ?? 0;
        const palInput = dEnabled && dOpt.palette ? (Array.isArray(dOpt.palette) ? dOpt.palette : (PALETTES[dOpt.palette] || [])) : [];
        const palCount = Math.min(32, palInput.length);
        for (let i = 0; i < palCount; i++) {
          const rgb = typeof palInput[i] === 'string' ? hexToRgb01(palInput[i]) : palInput[i];
          palBuf[i * 3] = rgb[0]; palBuf[i * 3 + 1] = rgb[1]; palBuf[i * 3 + 2] = rgb[2];
        }
        gl.uniform4f(pPost.u.u_dither, dStrength, dLevels, dOutline, palCount);
        gl.uniform3fv(pPost.u.u_pal, palBuf);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (timing) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); timing = false; }
      else if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) E.stats.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query); query = null;
      }
      E.stats.cpuMs = performance.now() - t0; E.stats.iw = iw; E.stats.ih = ih;
    };

    E.heights = function () {
      const d = new Uint8Array(iw * ih * 4), h = new Float32Array(iw * ih);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboG); gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, iw, ih, gl.RGBA, gl.UNSIGNED_BYTE, d);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      for (let i = 0; i < h.length; i++) h[i] = (d[i * 4] * 256 + d[i * 4 + 1]) / 65535 * HMAX;
      return h;
    };

    E.finish = function () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    };

    E.destroy = function () {
      releaseTargets();
      if (palTex) gl.deleteTexture(palTex);
      if (hmTex) gl.deleteTexture(hmTex);
      programs.forEach((p) => gl.deleteProgram(p));
      textures.forEach((t) => gl.deleteTexture(t));
      buffers.forEach((b) => gl.deleteBuffer(b));
      vaos.forEach((v) => gl.deleteVertexArray(v));
      fbos.forEach((f) => gl.deleteFramebuffer(f));
      rbos.forEach((r) => gl.deleteRenderbuffer(r));
    };

    return E;
  }

  function figureWriter(list, scale, lift) {
    const put = (st, i, x, y, z, rot) => {
      list.push({ stack: st, x: x * scale, y: y * scale, z: z * scale + (lift || 0), rot, scale, only: i });
    };
    return {
      slice: (st, i, x, y, z, rot) => put(st, i, x, y, z, rot),
      stack: (st, x, y, z, rot) => {
        for (let i = 0; i < st.slices.length; i++) put(st, i, x, y, z + st.slices[i].z, rot);
      },
      limb: (st, a, b, n) => {
        n = Math.max(n, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.8));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          put(st, 0, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 0.5, 0);
        }
      }
    };
  }

  global.Engine = { create, figureWriter, cameraMatrices, screenToWorld, HMAX, PALETTES };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- prefabs/vehicles.js ---
// prefabs/vehicles.js: Reusable parameterized vehicle definitions built on DSL.
(function (global) {
  'use strict';

  function registerPalette(pal, prefix, cols) {
    const c = Object.assign({
      body: '#d9383f', bodyDark: '#9c1f31', stripe: '#ffbe47',
      glass: '#58b4de', trim: '#242736', tire: '#1d1f2b',
      rim: '#cdd6e6', head: '#fff4ba', tail: '#ff3b30'
    }, cols || {});
    const map = {};
    Object.keys(c).forEach((k) => {
      const glow = k === 'head' ? 0.92 : k === 'tail' ? 0.88 : 0;
      map[k] = prefix + '_' + k;
      pal.ensure(map[k], c[k], glow);
    });
    return map;
  }

  function coupe(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_coupe';
    const m = registerPalette(pal, name, o.colors);

    return DSL.compile({
      name,
      w: 62, h: 30, layers: 20,
      ops: [
        // Main lower hull + wide fenders
        { op: 'box', min: [-28, -12, 2], max: [26, 12, 10], mat: m.body },
        { op: 'box', min: [-22, -13, 3], max: [-12, 13, 8], mat: m.bodyDark },
        { op: 'box', min: [12, -13, 3], max: [22, 13, 8], mat: m.bodyDark },
        // Sloped front hood
        { op: 'ramp', min: [10, -12, 7], max: [29, 12, 11], dir: '+x', mat: m.body },
        // Fastback greenhouse
        { op: 'box', min: [-12, -9.5, 11], max: [3, 9.5, 17], mat: m.glass },
        { op: 'ramp', min: [3, -9.5, 11], max: [12, 9.5, 17], dir: '+x', mat: m.glass },
        { op: 'ramp', min: [-22, -9.5, 11], max: [-12, 9.5, 17], dir: '-x', mat: m.glass },
        // Roof cap & pillars
        { op: 'box', min: [-11, -9.5, 16], max: [2, 9.5, 18], mat: m.body },
        // Racing twin stripes
        { op: 'box', min: [-27, 1.5, 10], max: [26, 3.5, 18], mat: m.stripe, paintOnly: true, mirrorY: true },
        // Splitter & rear diffuser
        { op: 'box', min: [25, -12, 2], max: [29, 12, 3], mat: m.trim },
        { op: 'box', min: [-29, -11, 2], max: [-26, 11, 4], mat: m.trim },
        // Headlights & taillight bar
        { op: 'box', min: [27, 5, 5], max: [29, 10, 7], mat: m.head, mirrorY: true },
        { op: 'box', min: [-29, 4, 7], max: [-27, 10, 9], mat: m.tail, mirrorY: true },
        // Rear spoiler wing with struts
        { op: 'box', min: [-27, 6.5, 10], max: [-25, 8.2, 15], mat: m.trim, mirrorY: true },
        { op: 'box', min: [-29, -12, 14], max: [-24, 12, 16], mat: m.body },
        // Side mirrors
        { op: 'box', min: [6, 11, 11], max: [9, 14.5, 13], mat: m.bodyDark, mirrorY: true },
        // Wheel well cutouts + 4 cylindrical tires & rims
        { op: 'cyl', a: [17, 9, 4], b: [17, 14, 4], r: 5.2, subtract: true, mirrorY: true },
        { op: 'cyl', a: [-17, 9, 4], b: [-17, 14, 4], r: 5.2, subtract: true, mirrorY: true },
        { op: 'cyl', a: [17, 9, 4], b: [17, 13, 4], r: 4.2, mat: m.tire, mirrorY: true },
        { op: 'cyl', a: [-17, 9, 4], b: [-17, 13, 4], r: 4.2, mat: m.tire, mirrorY: true },
        { op: 'cyl', a: [17, 11.5, 4], b: [17, 13.2, 4], r: 2.2, mat: m.rim, mirrorY: true },
        { op: 'cyl', a: [-17, 11.5, 4], b: [-17, 13.2, 4], r: 2.2, mat: m.rim, mirrorY: true },
      ]
    });
  }

  function airlinerHalf(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_airliner';
    const m = registerPalette(pal, name, Object.assign({
      body: '#dfe5ed', bodyDark: '#9eaac0', stripe: '#24589c',
      glass: '#49a6d4', trim: '#383e4d', head: '#ffd98a', tail: '#ff7b24'
    }, o.colors));

    return DSL.compile({
      name,
      w: 58, h: 48, layers: 22,
      ops: [
        // Main fuselage capsule + tapered nose
        { op: 'cyl', a: [-18, 0, 10], b: [16, 0, 10], r: 6.2, mat: m.body },
        { op: 'cyl', a: [16, 0, 10], b: [26, 0, 8], rA: 6.0, rB: 1.5, mat: m.body },
        // Hollow interior near rear cut exposing seats
        { op: 'cyl', a: [-20, 0, 10], b: [4, 0, 10], r: 4.6, subtract: true },
        { op: 'box', min: [-16, -4, 6], max: [4, 4, 7], mat: m.trim },
        { op: 'box', min: [-14, 1.6, 7], max: [-12, 3.6, 11], mat: m.stripe, mirrorY: true },
        { op: 'box', min: [-8, 1.6, 7], max: [-6, 3.6, 11], mat: m.stripe, mirrorY: true },
        { op: 'box', min: [-2, 1.6, 7], max: [0, 3.6, 11], mat: m.stripe, mirrorY: true },
        // Airline cheatline + cockpit glass
        { op: 'box', min: [-18, -7, 9], max: [20, 7, 10], mat: m.stripe, paintOnly: true },
        { op: 'ellipsoid', center: [19, 0, 12], radii: [3.2, 4.0, 2.0], mat: m.glass },
        // Swept wings + jet engines
        { op: 'cyl', a: [4, 4, 8], b: [-12, 22, 9], rA: 2.6, rB: 1.0, mat: m.bodyDark, mirrorY: true },
        { op: 'cyl', a: [1, 10, 5.5], b: [8, 10, 5.5], r: 2.0, mat: m.trim, mirrorY: true },
      ]
    });
  }

  global.PrefabVehicles = { coupe, airlinerHalf };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- prefabs/nature.js ---
// prefabs/nature.js: Trees, palms, rocks and clouds built with DSL & Art noise.
(function (global) {
  'use strict';

  function canopyTree(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_tree';
    const c = Object.assign({ trunk: '#5a3b29', leaf1: '#427846', leaf2: '#599654', leaf3: '#2e5735' }, o.colors);
    pal.ensure(name + '_trunk', c.trunk, 0);
    pal.ensure(name + '_l1', c.leaf1, 0);
    pal.ensure(name + '_l2', c.leaf2, 0);
    pal.ensure(name + '_l3', c.leaf3, 0);

    return DSL.compile({
      name,
      w: 24, h: 24, layers: 28, soft: 0.45,
      shadowIf: (x, y, z) => z < 11 ? Math.hypot(x, y) < 2.2 : Math.hypot(x, y) < 8.5,
      ops: [
        { op: 'cyl', a: [0, 0, 0], b: [0, 0, 12], rA: 2.3, rB: 1.5, mat: name + '_trunk' },
        { op: 'ellipsoid', center: [0, 0, 18], radii: [9.0, 9.0, 7.5], mat: name + '_l1' },
        { op: 'ellipsoid', center: [3, 2, 21], radii: [5.5, 5.5, 4.8], mat: name + '_l2' },
        { op: 'noisePaint', onlyOver: name + '_l1', scale: 0.35, seed: o.seed || 31, threshold: 0.62, mat: name + '_l2' },
        { op: 'noisePaint', onlyOver: name + '_l1', scale: 0.35, seed: (o.seed || 31) + 7, threshold: 0.72, mat: name + '_l3' },
      ]
    });
  }

  function palmTree(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_palm';
    const c = Object.assign({ trunk: '#705039', l1: '#3f7d3f', l2: '#599c49', l3: '#29592c' }, o.colors);
    pal.ensure(name + '_trunk', c.trunk, 0);
    pal.ensure(name + '_l1', c.l1, 0);
    pal.ensure(name + '_l2', c.l2, 0);
    pal.ensure(name + '_l3', c.l3, 0);

    const ops = [
      { op: 'cyl', a: [0, 0, 0], b: [2, 0, 12], rA: 1.8, rB: 1.4, mat: name + '_trunk' },
      { op: 'cyl', a: [2, 0, 12], b: [1, 0, 23], rA: 1.4, rB: 1.1, mat: name + '_trunk' },
    ];
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const dx = Math.cos(ang) * 8.5, dy = Math.sin(ang) * 8.5;
      ops.push({ op: 'cyl', a: [1, 0, 23], b: [1 + dx, dy, 19], rA: 1.2, rB: 0.5, mat: i & 1 ? name + '_l1' : name + '_l2' });
    }
    return DSL.compile({ name, w: 22, h: 22, layers: 28, soft: 0.5, ops });
  }

  function rock(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_rock';
    pal.ensure(name + '_r1', (o.colors && o.colors.r1) || '#6a6e7a', 0);
    pal.ensure(name + '_r2', (o.colors && o.colors.r2) || '#4e5361', 0);
    return DSL.compile({
      name,
      w: 12, h: 12, layers: 8,
      ops: [
        { op: 'dome', center: [0, 0, 0], radii: [4.8, 4.2, 6.2], mat: name + '_r1' },
        { op: 'ellipsoid', center: [1.5, -1, 2], radii: [3.2, 2.8, 3.2], mat: name + '_r2' },
        { op: 'noisePaint', scale: 0.4, seed: o.seed || 9, threshold: 0.58, mat: name + '_r2' }
      ]
    });
  }

  global.PrefabNature = { canopyTree, palmTree, rock };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- prefabs/architecture.js ---
// prefabs/architecture.js: Modular buildings, lamps, crates and ground tiles.
(function (global) {
  'use strict';

  function brickHouse(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_house';
    const c = Object.assign({
      wall: '#8c534c', wall2: '#70403b', roof: '#3d455c',
      trim: '#888f9e', door: '#4e5870', win: '#ffd27a'
    }, o.colors);
    pal.ensure(name + '_w1', c.wall, 0);
    pal.ensure(name + '_w2', c.wall2, 0);
    pal.ensure(name + '_roof', c.roof, 0);
    pal.ensure(name + '_trim', c.trim, 0);
    pal.ensure(name + '_door', c.door, 0);
    pal.ensure(name + '_win', c.win, 0.85);

    return DSL.compile({
      name,
      w: 36, h: 28, layers: 26,
      ops: [
        { op: 'box', min: [-16, -12, 0], max: [16, 12, 16], mat: name + '_w1' },
        { op: 'hollow', minZ: 1, maxZ: 15 },
        { op: 'noisePaint', onlyOver: name + '_w1', scale: 0.4, seed: 12, threshold: 0.62, mat: name + '_w2' },
        { op: 'box', min: [-16, -12, 0], max: [16, 12, 2], mat: name + '_trim', paintOnly: true },
        // Open front door & glowing windows
        { op: 'box', min: [-4, -12, 1], max: [4, -10, 10], mat: name + '_door' },
        { op: 'box', min: [-12, -12, 6], max: [-8, -10, 11], mat: name + '_win' },
        { op: 'box', min: [8, -12, 6], max: [12, -10, 11], mat: name + '_win' },
        // Pitched roof (two mirrored slopes)
        { op: 'ramp', min: [-17, -13, 16], max: [17, 0, 25], dir: '-y', mat: name + '_roof' },
        { op: 'ramp', min: [-17, 0, 16], max: [17, 13, 25], dir: '+y', mat: name + '_roof' },
      ]
    });
  }

  function streetLamp(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_lamp';
    pal.ensure(name + '_iron', (o.colors && o.colors.iron) || '#33384a', 0);
    pal.ensure(name + '_bulb', (o.colors && o.colors.bulb) || '#ffe599', 0.95);
    return DSL.compile({
      name,
      w: 12, h: 12, layers: 32,
      ops: [
        { op: 'cyl', a: [0, 0, 0], b: [0, 0, 3], r: 2.0, mat: name + '_iron' },
        { op: 'cyl', a: [0, 0, 3], b: [0, 0, 30], r: 0.9, mat: name + '_iron' },
        { op: 'box', min: [0, -0.7, 29], max: [4.5, 0.7, 30.5], mat: name + '_iron' },
        { op: 'box', min: [3, -1.0, 27.5], max: [5, 1.0, 29], mat: name + '_bulb' },
      ]
    });
  }

  function flatGroundTile(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_tile';
    const c1 = (o.colors && o.colors.c1) || '#262938';
    const c2 = (o.colors && o.colors.c2) || '#2d3142';
    const grid = (o.colors && o.colors.grid) || '#363c52';
    pal.ensure(name + '_c1', c1, 0);
    pal.ensure(name + '_c2', c2, 0);
    pal.ensure(name + '_g', grid, 0);
    const size = o.size || 48;
    const step = o.gridStep || 12;
    return {
      name, w: size, h: size, layers: 2, pad: 2, ground: true,
      fn: function (x, y, z) {
        if (z > 0) return null;
        if (step && (Math.abs(Math.floor(x) % step) === 0 || Math.abs(Math.floor(y) % step) === 0)) return name + '_g';
        return Art.noise(x * 0.3, y * 0.3, o.seed || 7) > 0.6 ? name + '_c2' : name + '_c1';
      }
    };
  }

  global.PrefabArch = { brickHouse, streetLamp, flatGroundTile };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- prefabs/props.js ---
// prefabs/props.js: Reusable desks, monitors, crates, barrels and glowing effects.
(function (global) {
  'use strict';

  function deskStation(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_desk';
    const c = Object.assign({ wood: '#6e503a', frame: '#2c3142', screen: '#5ef5ff', chair: '#364f78' }, o.colors);
    pal.ensure(name + '_wood', c.wood, 0);
    pal.ensure(name + '_frame', c.frame, 0);
    pal.ensure(name + '_scr', c.screen, 0.92);
    pal.ensure(name + '_chair', c.chair, 0);

    return DSL.compile({
      name,
      w: 18, h: 16, layers: 14,
      ops: [
        // Desk legs + tabletop
        { op: 'box', min: [-7, 4, 0], max: [-5, 6, 5], mat: name + '_frame', mirrorX: true },
        { op: 'box', min: [-7, -2, 0], max: [-5, 0, 5], mat: name + '_frame', mirrorX: true },
        { op: 'box', min: [-8, -3, 5], max: [8, 7, 6], mat: name + '_wood' },
        // Dual monitors + glowing screen
        { op: 'box', min: [-5, 4, 6], max: [5, 5, 11], mat: name + '_frame' },
        { op: 'box', min: [-4, 3.6, 7], max: [4, 4.2, 10], mat: name + '_scr' },
        // Keyboard
        { op: 'box', min: [-3, 0, 6.2], max: [3, 2, 6.6], mat: name + '_frame' },
        // Office chair
        { op: 'cyl', a: [0, -5, 0], b: [0, -5, 3], r: 2.2, mat: name + '_frame' },
        { op: 'box', min: [-3, -7, 3], max: [3, -3, 4.5], mat: name + '_chair' },
        { op: 'box', min: [-3, -7, 4.5], max: [3, -6, 9], mat: name + '_chair' },
      ]
    });
  }

  function crate(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_crate';
    pal.ensure(name + '_w', (o.colors && o.colors.wood) || '#70523c', 0);
    pal.ensure(name + '_f', (o.colors && o.colors.frame) || '#7b87a1', 0);
    return DSL.compile({
      name,
      w: 12, h: 12, layers: 10,
      ops: [
        { op: 'box', min: [-5, -5, 0], max: [5, 5, 9], mat: name + '_f' },
        { op: 'box', min: [-4, -4, 1], max: [4, 4, 8], mat: name + '_w' },
      ]
    });
  }

  function barrel(pal, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_barrel';
    pal.ensure(name + '_b', (o.colors && o.colors.body) || '#cf3636', 0);
    pal.ensure(name + '_s', (o.colors && o.colors.stripe) || '#ffd24a', 0);
    pal.ensure(name + '_r', (o.colors && o.colors.rim) || '#7b87a1', 0);
    return DSL.compile({
      name,
      w: 8, h: 8, layers: 10,
      ops: [
        { op: 'cyl', a: [0, 0, 0], b: [0, 0, 9], r: 3.0, mat: name + '_b' },
        { op: 'cyl', a: [0, 0, 4], b: [0, 0, 5], r: 3.1, mat: name + '_s' },
        { op: 'cyl', a: [0, 0, 0], b: [0, 0, 0.5], r: 3.1, mat: name + '_r' },
        { op: 'cyl', a: [0, 0, 8.5], b: [0, 0, 9], r: 3.1, mat: name + '_r' },
      ]
    });
  }

  global.PrefabProps = { deskStation, crate, barrel };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- prefabs/characters.js ---
// prefabs/characters.js: Parameterized IK humanoid builder & drawer using core/rig.js.
(function (global) {
  'use strict';

  function humanoid(pal, atlas, shell, opts) {
    const o = opts || {};
    const name = o.name || 'prefab_human';
    const c = Object.assign({
      jacket: '#2f65ad', pants: '#1c3254', skin: '#eab896',
      hair: '#3b2820', boots: '#232633', accent: '#5ef5ff'
    }, o.colors);

    const m = {};
    Object.keys(c).forEach((k) => {
      m[k] = name + '_' + k;
      pal.ensure(m[k], c[k], k === 'accent' && o.glowAccent ? 0.9 : 0);
    });

    const ell = (x, y, rx, ry) => (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
    const defs = [
      { name: name + '_head', w: 12, h: 12, layers: 9, fn: (x, y, z) => {
        const r = z >= 5 ? 4.2 : z === 0 ? 2.4 : 4.0;
        if (x * x + y * y > r * r) return null;
        if (z >= 6) return m.hair;
        if (z >= 3 && z <= 5 && x > 2.2 && Math.abs(y) < 2.8) return o.visor ? m.accent : m.skin;
        return x > 0.3 ? m.skin : m.hair;
      } },
      { name: name + '_torso', w: 14, h: 16, layers: 11, fn: (x, y, z) => {
        if (z <= 1) return ell(x, y, 2.5, 4.0) ? m.pants : null;
        const rx = z >= 8 ? 2.8 : 3.0, ry = z >= 8 ? 6.4 : 4.4 + (z - 2) * 0.32;
        if (!ell(x, y, rx, ry)) return null;
        if (z >= 5 && z <= 8 && x > 1.6 && Math.abs(y) < 2.6) return m.accent;
        return m.jacket;
      } },
      { name: name + '_arm', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 1.7, 1.7) ? m.jacket : null },
      { name: name + '_hand', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 1.5, 1.5) ? m.skin : null },
      { name: name + '_thigh', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 2.2, 2.2) ? m.pants : null },
      { name: name + '_shin', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 1.9, 1.9) ? m.pants : null },
      { name: name + '_boot', w: 7, h: 5, layers: 3, fn: (x, y, z) => x > -2.2 && x < (z === 2 ? 1.2 : 3.0) && Math.abs(y) < 1.9 ? m.boots : null },
    ];

    const parts = {};
    defs.forEach((d) => {
      const short = d.name.slice(name.length + 1);
      parts[short] = Art.buildStack(d, pal, atlas, shell ?? 3);
    });

    const cfg = Object.assign({
      thigh: 7, shin: 7, ankle: 1.5, hipHalf: 2.3, standHip: 13.0, kneeHint: 1,
      stride: 18, duty: 0.56, lift: 2.8, bob: 0.45, twist: 0.14, spine: 9.2,
      arms: true, shoulderHalf: 6.8, upperArm: 4.5, foreArm: 4.5, armSwing: 0.35
    }, o.rigCfg);

    function draw(list, walker, scale, lift, headAngle) {
      const P = Rig.pose(walker);
      const R = Engine.figureWriter(list, scale, lift || 0);
      for (let i = 0; i < 2; i++) {
        const L = P.legs[i];
        R.stack(parts.boot, L.sole[0], L.sole[1], L.sole[2], L.rot);
        R.limb(parts.shin, L.ankle, L.knee, 5);
        R.limb(parts.thigh, L.knee, L.hip, 5);
      }
      const T = parts.torso, z0 = P.pelvis[2] - 1;
      for (let i = 0; i < T.slices.length; i++) {
        const s = T.slices[i], t = Math.min(1, s.z / (T.n - 2));
        const targetA = headAngle ?? P.shouldersAngle;
        const diff = ((targetA - P.hipsAngle) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        R.slice(T, i, P.x, P.y, z0 + s.z, P.hipsAngle + diff * t);
      }
      R.stack(parts.head, P.x, P.y, z0 + T.n, headAngle ?? P.shouldersAngle);
      for (let i = 0; i < 2; i++) {
        const A = P.arms[i];
        R.limb(parts.arm, A.shoulder, A.elbow, 4);
        R.limb(parts.arm, A.elbow, A.hand, 4);
        R.slice(parts.hand, 0, A.hand[0], A.hand[1], A.hand[2], P.shouldersAngle);
      }
    }

    return { parts, cfg, draw };
  }

  global.PrefabCharacters = { humanoid };
})(typeof window !== 'undefined' ? window : globalThis);


  // --- prefabs/index.js ---
// prefabs/index.js: Unified Prefabs registry.
(function (global) {
  'use strict';

  global.Prefabs = Object.assign(
    {},
    global.PrefabVehicles || {},
    global.PrefabNature || {},
    global.PrefabArch || {},
    global.PrefabProps || {},
    global.PrefabCharacters || {}
  );
})(typeof window !== 'undefined' ? window : globalThis);


  // --- core/studio.js ---
// core/studio.js: Agnostic scene orchestrator over Engine, Art, DSL, Importers, Rig, and Prefabs.
(function (global) {
  'use strict';

  function defaultLight(t, flash) {
    const K = [
      { t: 0.0, el: 42, az: -38, sun: [1.36, 1.24, 1.0], sky: [0.42, 0.52, 0.68], bounce: [0.32, 0.28, 0.18], haze: [0.84, 0.88, 0.94], hazeK: 0.14, glow: 0.15, exposure: 1.02 },
      { t: 0.55, el: 16, az: -20, sun: [1.56, 0.98, 0.50], sky: [0.35, 0.38, 0.62], bounce: [0.32, 0.22, 0.14], haze: [0.94, 0.72, 0.56], hazeK: 0.28, glow: 0.55, exposure: 1.05 },
      { t: 1.0, el: 7, az: 12, sun: [0.46, 0.40, 0.70], sky: [0.20, 0.23, 0.42], bounce: [0.15, 0.12, 0.18], haze: [0.16, 0.18, 0.30], hazeK: 0.32, glow: 1.0, exposure: 1.15 }
    ];
    t = Math.max(0, Math.min(1, t ?? 0.5));
    const b = t < K[1].t ? 1 : 2, A = K[b - 1], B = K[b];
    let u = (t - A.t) / (B.t - A.t);
    u = u * u * (3 - 2 * u);
    const mix = (k) => typeof A[k] === 'number'
      ? A[k] + (B[k] - A[k]) * u
      : A[k].map((v, i) => v + (B[k][i] - v) * u);
    const el = mix('el') * Math.PI / 180, az = mix('az') * Math.PI / 180;
    const sunCol = mix('sun'), skyCol = mix('sky'), hazeCol = mix('haze');
    if (flash > 0.01) {
      sunCol[0] += flash * 1.4; sunCol[1] += flash * 1.6; sunCol[2] += flash * 2.2;
      skyCol[0] += flash * 0.5; skyCol[1] += flash * 0.7; skyCol[2] += flash * 1.1;
    }
    return {
      sun: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
      sunCol, skyCol, bounceCol: mix('bounce'),
      hazeCol, hazeK: mix('hazeK'), glow: mix('glow'),
      exposure: mix('exposure'), outer: [0.14, 0.18, 0.26], cloud: 0
    };
  }

  function normalizeSpec(raw) {
    const s = raw || {};
    return {
      atlasSize: s.atlasSize || 2048,
      shell: s.shell ?? 3,
      world: Object.assign({ w: 144, h: 144, ground: 1, autoTiles: true, tileSize: 48, floorColors: null }, s.world),
      palette: s.palette || {},
      assets: s.assets || {},
      characters: s.characters || {},
      entities: (s.entities || []).map((e) => Object.assign({ x: 0, y: 0, z: 0, rot: 0, pitch: 0, roll: 0, scale: 1 }, e)),
      lamps: s.lamps ? s.lamps.slice() : [],
      blobs: s.blobs ? s.blobs.slice() : [],
      camera: Object.assign({ mode: 'persp', tx: 72, ty: 72, tz: 4, yaw: 0.78, pitch: 0.45, dist: 62, fov: 38 * Math.PI / 180 }, s.camera),
      lighting: Object.assign({ tod: 0.55, flash: 0 }, s.lighting),
      render: Object.assign({
        scale: 3, voxel: true, shadows: true, ao: true, bloom: true,
        shadowSteps: 24, aoSamples: 16, hsr: true, fill: true, guard: true,
        water: null, dither: { enabled: false, strength: 0.6, levels: 8, outline: 0, palette: null }
      }, s.render),
      autoOrbit: !!s.autoOrbit,
      orbitSpeed: s.orbitSpeed ?? 0.25
    };
  }

  function makeSliceFX(fx) {
    if (!fx) return null;
    const build = fx.build ?? 1.0;
    const explode = fx.explode ?? 0.0;
    const maxLayer = fx.maxLayer ?? 9999;
    if (build >= 0.999 && explode <= 0.001 && maxLayer >= 9999) return null;
    return (z, n, out) => {
      if (z > maxLayer || z > build * n) return null;
      out.dx = 0; out.dy = 0; out.dz = 0; out.rot = 0; out.scale = 1;
      if (build < 0.999 && z > build * n - 1.5) {
        out.dz += (1 - (build * n - z) / 1.5) * 5.0;
      }
      if (explode > 0.001 && z > 1) {
        out.dz += z * explode * 1.25;
      }
      return out;
    };
  }

  function mount(canvas, sceneSpec, options) {
    const opts = options || {};
    const spec = normalizeSpec(sceneSpec);
    const E = Engine.create(canvas);
    const pal = new Art.Palette();
    const atlas = new Art.Atlas(spec.atlasSize);

    // 1. Register explicit palette entries
    Object.keys(spec.palette).forEach((name) => {
      const v = spec.palette[name];
      if (typeof v === 'string') pal.ensure(name, v, 0);
      else pal.ensure(name, v.hex, v.glow || 0);
    });

    // 2. Build assets (prefab | dsl | raw | vox | sliceStrip)
    const stacks = {};
    const registerDef = (key, def) => {
      stacks[key] = Art.buildStack(def, pal, atlas, spec.shell);
    };

    if (spec.world.autoTiles) {
      const ts = spec.world.tileSize || 48;
      const nx = Math.max(1, Math.ceil(spec.world.w / ts));
      const ny = Math.max(1, Math.ceil(spec.world.h / ts));
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          const def = Prefabs.flatGroundTile(pal, {
            name: `_ground_${tx}_${ty}`,
            size: ts,
            colors: spec.world.floorColors,
            seed: tx * 13 + ty * 37
          });
          registerDef(def.name, def);
        }
      }
    }

    Object.keys(spec.assets).forEach((key) => {
      const a = spec.assets[key];
      if (a.type === 'prefab') {
        const fn = Prefabs[a.prefab];
        if (!fn) throw new Error('Unknown prefab: ' + a.prefab);
        registerDef(key, fn(pal, Object.assign({ name: key }, a.opts)));
      } else if (a.type === 'dsl') {
        registerDef(key, DSL.compile(Object.assign({ name: key }, a.spec)));
      } else if (a.type === 'vox') {
        registerDef(key, Importers.fromVox(a.buffer, pal, Object.assign({ name: key }, a.opts)));
      } else if (a.type === 'sliceStrip') {
        registerDef(key, Importers.fromSliceStrip(a.pixels, a.imgW, a.imgH, a.sliceW, a.sliceH, pal, Object.assign({ name: key }, a.opts)));
      } else if (a.type === 'raw') {
        registerDef(key, Object.assign({ name: key }, a.def));
      }
    });

    // 3. Build parameterized characters
    const chars = {};
    Object.keys(spec.characters).forEach((cid) => {
      const cSpec = spec.characters[cid];
      const built = Prefabs.humanoid(pal, atlas, spec.shell, Object.assign({ name: 'ch_' + cid }, cSpec));
      const walker = Rig.createWalker(built.cfg);
      Rig.place(walker, (cSpec.x || 0) / (cSpec.scale || 0.25), (cSpec.y || 0) / (cSpec.scale || 0.25), cSpec.rot || 0);
      chars[cid] = {
        spec: cSpec,
        built,
        walker,
        scale: cSpec.scale || 0.25,
        lift: cSpec.z ?? spec.world.ground,
        headAngle: cSpec.headAngle
      };
    });

    const atlasTex = E.makeAtlas(atlas.data, atlas.size);
    E.setPalette(pal.bytes());

    // 4. Build initial items & static height map
    const groundItems = [];
    if (spec.world.autoTiles) {
      const ts = spec.world.tileSize || 48;
      const nx = Math.max(1, Math.ceil(spec.world.w / ts));
      const ny = Math.max(1, Math.ceil(spec.world.h / ts));
      for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
        groundItems.push({ stack: stacks[`_ground_${tx}_${ty}`], x: tx * ts + ts / 2, y: ty * ts + ts / 2, z: 0, rot: 0, scale: 1 });
      }
    }

    function makeItem(e) {
      const st = stacks[e.asset];
      if (!st) throw new Error('Unknown asset in entity: ' + e.asset);
      return {
        id: e.id || null,
        stack: st,
        x: e.x, y: e.y, z: e.z,
        rot: e.rot || 0, pitch: e.pitch || 0, roll: e.roll || 0,
        scale: e.scale || 1,
        sway: e.sway || 0,
        only: e.only ?? -1,
        shx: 0, shy: 0,
        each: makeSliceFX(e.sliceFX),
        _baseX: e.x, _baseY: e.y, _baseZ: e.z, _baseRot: e.rot || 0,
        shadow: e.shadow !== false
      };
    }

    let items = spec.entities.map(makeItem);

    function rebuildHeightMap() {
      const W = spec.world.w, H = spec.world.h;
      const hm = new Uint8Array(W * H);
      hm.fill((spec.world.ground || 0) * 2);
      items.forEach((it) => {
        if (!it.shadow || it.stack.def.noShadow || it.stack.def.ground) return;
        const st = it.stack, d = st.def, c = Math.cos(it.rot), s = Math.sin(it.rot);
        for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
          const lx = x + 0.5 - st.w / 2, ly = y + 0.5 - st.h / 2;
          let z = st.n - 1;
          while (z >= 0 && !(st.vox[(z * st.h + y) * st.w + x] && (!d.shadowIf || d.shadowIf(lx, ly, z)))) z--;
          if (z < 0) continue;
          const wx = it.x + (lx * c - ly * s) * it.scale;
          const wy = it.y + (lx * s + ly * c) * it.scale;
          const v = Math.min(255, Math.round((it.z + (z + 1) * it.scale) * 2));
          for (let k = 0; k < 4; k++) {
            const cx = Math.floor(wx + (k & 1) * 0.6 - 0.3);
            const cy = Math.floor(wy + (k >> 1) * 0.6 - 0.3);
            if (cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1 && v > hm[cy * W + cx]) hm[cy * W + cx] = v;
          }
        }
      });
      E.setHeightMap(hm, W, H);
    }
    rebuildHeightMap();

    // 5. ResizeObserver + Visibility pause + Optional Orbit
    let simTime = 0;
    let paused = false;
    let rafId = 0;
    let lastNow = performance.now();
    let drag = null;

    function syncSize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(128, Math.round((canvas.clientWidth || canvas.width || 640) * dpr));
      const ch = Math.max(128, Math.round((canvas.clientHeight || canvas.height || 360) * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
    }
    syncSize();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncSize);
      ro.observe(canvas);
    }

    let interactiveOrbit = opts.interactive !== false;
    const onDown = (e) => {
      if (!interactiveOrbit) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = spec.camera.dist * 0.0014;
        const sy = Math.sin(spec.camera.yaw), cy = Math.cos(spec.camera.yaw);
        spec.camera.tx -= (dx * sy - dy * cy) * k;
        spec.camera.ty += (dx * cy + dy * sy) * k;
      } else {
        spec.camera.yaw -= dx * 0.007;
        spec.camera.pitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, spec.camera.pitch + dy * 0.006));
      }
    };
    const onUp = () => { drag = null; };
    const onWheel = (e) => {
      if (!interactiveOrbit) return;
      e.preventDefault();
      spec.camera.dist = Math.max(12, Math.min(240, spec.camera.dist + e.deltaY * 0.05));
    };
    const onCtx = (e) => { if (interactiveOrbit) e.preventDefault(); };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);

    const onVis = () => {
      if (document.hidden) paused = true;
    };
    document.addEventListener('visibilitychange', onVis);

    const api = {
      engine: E,
      atlas,
      palette: pal,
      stacks,
      characters: chars,
      get spec() { return spec; },

      setCamera(camPatch) {
        Object.assign(spec.camera, camPatch);
      },
      getCamera() {
        return Object.assign({}, spec.camera);
      },
      screenToWorld(clientX, clientY, planeZ) {
        const rect = canvas.getBoundingClientRect();
        const nx = ((clientX - rect.left) / (rect.width || 1)) * 2 - 1;
        const ny = 1 - ((clientY - rect.top) / (rect.height || 1)) * 2;
        return Engine.screenToWorld(spec.camera, canvas.width / canvas.height, nx, ny, planeZ ?? spec.world.ground);
      },
      setTime(tSec) {
        simTime = tSec;
        for (const it of items) {
          if (it.sway) {
            it.shx = Math.sin(simTime * 1.7 + it.x) * it.sway;
            it.shy = Math.cos(simTime * 1.3 + it.y) * it.sway * 0.7;
          }
        }
        if (opts.onUpdate) opts.onUpdate(simTime, 0, api);
      },
      moveCharacter(id, x, y, heading, dt, headAngle) {
        const ch = chars[id];
        if (!ch) return;
        Rig.step(ch.walker, x / ch.scale, y / ch.scale, heading, dt || 1 / 60);
        if (headAngle !== undefined) ch.headAngle = headAngle;
      },
      updateScene(patch) {
        if (!patch) return;
        if (patch.lighting) Object.assign(spec.lighting, patch.lighting);
        if (patch.render) Object.assign(spec.render, patch.render);
        if (patch.lamps) spec.lamps = patch.lamps;
        if (patch.blobs) spec.blobs = patch.blobs;
        if (patch.entities) {
          items = patch.entities.map(makeItem);
          rebuildHeightMap();
        }
        if (patch.entityUpdates) {
          for (const u of patch.entityUpdates) {
            const target = items.find((it) => it.id === u.id);
            if (!target) continue;
            if (u.x !== undefined) target.x = u.x;
            if (u.y !== undefined) target.y = u.y;
            if (u.z !== undefined) target.z = u.z;
            if (u.rot !== undefined) target.rot = u.rot;
            if (u.pitch !== undefined) target.pitch = u.pitch;
            if (u.roll !== undefined) target.roll = u.roll;
            if (u.scale !== undefined) target.scale = u.scale;
            if (u.sliceFX !== undefined) target.each = makeSliceFX(u.sliceFX);
          }
        }
      },
      renderFrame() {
        syncSize();
        const list = groundItems.concat(items);
        Object.keys(chars).forEach((cid) => {
          const ch = chars[cid];
          ch.built.draw(list, ch.walker, ch.scale, ch.lift, ch.headAngle);
        });
        const env = defaultLight(spec.lighting.tod, spec.lighting.flash);
        const waterId = spec.render.water ? (pal.names[spec.render.water] ?? -9) : -9;
        E.render({
          cam: spec.camera,
          list,
          atlas: atlasTex,
          hsr: spec.render.hsr,
          fill: spec.render.fill,
          guard: spec.render.guard,
          voxel: spec.render.voxel === 'auto' ? spec.camera.pitch < 0.32 : !!spec.render.voxel,
          lod: false,
          heat: 0,
          measure: false,
          scale: spec.render.scale,
          shadows: spec.render.shadows,
          ao: spec.render.ao,
          bloom: spec.render.bloom,
          shadowSteps: spec.render.shadowSteps,
          aoSamples: spec.render.aoSamples,
          dither: spec.render.dither,
          water: waterId,
          ground: spec.world.ground,
          time: simTime,
          light: env,
          lamps: spec.lamps,
          blobs: spec.blobs
        });
        return E.stats;
      },
      readPixels() {
        const w = canvas.width, h = canvas.height;
        const buf = new Uint8Array(w * h * 4);
        E.gl.bindFramebuffer(E.gl.FRAMEBUFFER, null);
        E.gl.readPixels(0, 0, w, h, E.gl.RGBA, E.gl.UNSIGNED_BYTE, buf);
        return { width: w, height: h, data: buf };
      },
      toBlob(type, quality) {
        return new Promise((resolve) => canvas.toBlob(resolve, type || 'image/png', quality));
      },
      setInteractiveOrbit(enabled) { interactiveOrbit = !!enabled; },
      pause() { paused = true; },
      resume() {
        if (!paused) return;
        paused = false;
        lastNow = performance.now();
      },
      destroy() {
        cancelAnimationFrame(rafId);
        if (ro) ro.disconnect();
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onCtx);
        document.removeEventListener('visibilitychange', onVis);
        E.destroy();
      }
    };

    if (opts.loop !== false) {
      const tick = (now) => {
        rafId = requestAnimationFrame(tick);
        if (paused) return;
        const dt = Math.min(0.05, (now - lastNow) / 1000);
        lastNow = now;
        simTime += dt;
        if (spec.autoOrbit && !drag) spec.camera.yaw += dt * spec.orbitSpeed;
        for (const it of items) {
          if (it.sway) {
            it.shx = Math.sin(simTime * 1.7 + it.x) * it.sway;
            it.shy = Math.cos(simTime * 1.3 + it.y) * it.sway * 0.7;
          }
        }
        if (opts.onUpdate) opts.onUpdate(simTime, dt, api);
        api.renderFrame();
      };
      rafId = requestAnimationFrame(tick);
    } else {
      api.renderFrame();
    }

    return api;
  }

  global.Studio = { mount, normalizeSpec, defaultLight };
})(typeof window !== 'undefined' ? window : globalThis);


  const api = {
    Art: root.Art,
    Rig: root.Rig,
    DSL: root.DSL,
    Importers: root.Importers,
    Exporters: root.Exporters,
    Prefabs: root.Prefabs,
    Engine: root.Engine,
    Studio: root.Studio,
  };
  root.LeVox = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
