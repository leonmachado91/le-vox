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
