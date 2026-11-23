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
