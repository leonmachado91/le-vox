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
