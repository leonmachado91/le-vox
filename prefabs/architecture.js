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
