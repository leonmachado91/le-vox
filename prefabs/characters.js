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
