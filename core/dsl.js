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
