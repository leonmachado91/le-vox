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
