// car_scene.js: TURBO-86 retro coupe & corner garage diorama for loktar00/sprite-stack-engine.
// Coordinates inside stack functions: x forward (+nose, -tail), y sideways, z layer up (0 = ground).
(function (global) {
  'use strict';

  const abs = Math.abs, floor = Math.floor, hypot = Math.hypot, max = Math.max, min = Math.min;
  const hash = Art.hash, noise = Art.noise;
  const n3 = (x, y, z, s) => noise(x + z * 5.1, y - z * 3.9, s);
  const ell = (x, y, rx, ry) => (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;

  const TILE = 48, NX = 3, NY = 3;
  const WORLD = { w: TILE * NX, h: TILE * NY }; // 144 x 144

  function palette() {
    const P = new Art.Palette();
    // Road & ground
    P.add('asphalt1', '#262938');
    P.add('asphalt2', '#2d3142');
    P.add('asphalt3', '#202330');
    P.add('roadLine', '#f0b840');
    P.add('roadWhite', '#d6dce8');
    P.add('curbA', '#8e96ab');
    P.add('curbB', '#586075');
    P.add('sidewalk1', '#697187');
    P.add('sidewalk2', '#5d6478');
    P.add('grass1', '#3b6647');
    P.add('grass2', '#4c7a52');
    P.add('grass3', '#2f523a');
    P.add('garageFloor', '#3a4054');
    P.add('garageLine', '#e09f3e');

    // Car body (crimson racing coupe with warm/cool shading)
    P.add('paint1', '#d9383f');
    P.add('paint2', '#eb4b4b');
    P.add('paintD', '#9c1f31');
    P.add('stripe', '#ffbe47');
    P.add('stripe2', '#e88a2c');
    P.add('trim', '#242736');
    P.add('grille', '#161822');
    P.add('glass', '#58b4de');
    P.add('glassD', '#2e729e');
    P.add('tire', '#1d1f2b');
    P.add('tireTread', '#2a2d3d');
    P.add('alloy', '#cdd6e6');
    P.add('alloyD', '#8b96ad');
    P.add('steel', '#aeb8cc');
    P.add('seat', '#383d52');
    P.add('plate', '#e8eef7');

    // Emissives (0..1 glow: 0.85 lights up strongest at sunset/dusk!)
    P.add('headlight', '#fff4ba', 0.92);
    P.add('taillight', '#ff3b30', 0.88);
    P.add('lampBulb', '#ffe599', 0.95);
    P.add('neonCyan', '#4ef2ff', 0.95);
    P.add('neonPink', '#ff598f', 0.95);
    P.add('winLit', '#ffd27a', 0.75);

    // Garage & props
    P.add('brick1', '#7c4c48');
    P.add('brick2', '#945b52');
    P.add('brick3', '#613a38');
    P.add('mortar', '#a38f84');
    P.add('conc1', '#888f9e');
    P.add('conc2', '#707787');
    P.add('roof1', '#3d455c');
    P.add('roof2', '#2f364a');
    P.add('doorM', '#56617a');
    P.add('doorM2', '#444d63');
    P.add('coneO', '#f56a2c');
    P.add('coneW', '#eef2f7');
    P.add('drumR', '#c44536');
    P.add('drumB', '#356b9c');
    P.add('wood1', '#875c3e');
    P.add('wood2', '#6b472f');
    P.add('trunk', '#523828');
    P.add('leaf1', '#477d49');
    P.add('leaf2', '#5b9654');
    P.add('leaf3', '#36613c');
    P.add('iron', '#33384a');
    return P;
  }

  // Ground classification at world (wx, wy)
  // Road runs along Y centered at y=76 (width 48), garage sits at north side (y < 46)
  function groundKind(wx, wy) {
    if (wy >= 50 && wy <= 104) return 'road';
    if (wy >= 44 && wy < 50) return 'curbN';
    if (wy > 104 && wy <= 110) return 'curbS';
    if (wy < 44) {
      if (wx >= 30 && wx <= 98 && wy >= 14 && wy <= 44) return 'apron';
      return 'sidewalk';
    }
    return 'grass';
  }

  function makeGroundTile(tx, ty) {
    const ox = tx * TILE + TILE / 2, oy = ty * TILE + TILE / 2;
    return {
      name: `ground_${tx}_${ty}`,
      w: TILE, h: TILE, layers: 3, pad: 2, ground: true,
      fn: function (x, y, z) {
        const wx = ox + x, wy = oy + y;
        const k = groundKind(wx, wy);
        if (k === 'road') {
          if (z > 0) return null;
          // Center dashed yellow line at y=77
          if (abs(wy - 77) < 1.0 && ((floor(wx) % 14 + 14) % 14) < 7) return 'roadLine';
          // Crosswalk / edge lines
          if (abs(wy - 52) < 0.7 || abs(wy - 102) < 0.7) return 'roadWhite';
          const q = noise(wx * 0.45, wy * 0.45, 11);
          return q > 0.65 ? 'asphalt2' : q < 0.25 ? 'asphalt3' : 'asphalt1';
        }
        if (k === 'curbN' || k === 'curbS') {
          if (z > 1) return null;
          if (wy >= 48 || wy <= 106) return floor(wx / 4) & 1 ? 'curbA' : 'curbB';
          return hash(floor(wx), floor(wy), 2) < 0.35 ? 'sidewalk2' : 'sidewalk1';
        }
        if (k === 'apron') {
          if (z > 1) return null;
          if (z === 1 && (abs(wx - 31) < 1.2 || abs(wx - 97) < 1.2) && wy > 24) return floor(wy / 3) & 1 ? 'garageLine' : 'trim';
          return ((floor(wx / 4) + floor(wy / 4)) & 1) ? 'garageFloor' : 'asphalt2';
        }
        if (k === 'sidewalk') {
          if (z > 1) return null;
          const joint = (floor(wx) % 8 === 0) || (floor(wy) % 8 === 0);
          return joint ? 'sidewalk2' : hash(floor(wx * 0.8), floor(wy * 0.8), 4) < 0.3 ? 'sidewalk2' : 'sidewalk1';
        }
        // Grass park south of road
        if (z > 1) return null;
        if (z === 1 && hash(floor(wx), floor(wy), 17) > 0.88) return 'grass2';
        const gq = noise(wx * 0.25, wy * 0.25, 19);
        return gq > 0.62 ? 'grass2' : gq < 0.3 ? 'grass3' : 'grass1';
      }
    };
  }

  // ---------------------------------------------------------------- TURBO-86 Coupe (64 x 32 x 22)
  function carPaint(x, y, z) {
    const q = n3(x * 0.18, y * 0.18, z * 0.25, 77);
    return q > 0.72 ? 'paint2' : q < 0.24 ? 'paintD' : 'paint1';
  }

  const turbo86 = {
    name: 'turbo86',
    w: 64,
    h: 32,
    layers: 22,
    fn: function (x, y, z) {
      const ay = abs(y);

      // 1. Rear Wing / Spoiler (suspended at z=15..17, x=-29..-23.5, with daylight gap!)
      if (z >= 12 && z <= 17 && x <= -23.5 && x >= -29.2) {
        // Wing struts at ay in [6.5, 8.2]
        if (z >= 11 && z <= 15 && x >= -27.2 && x <= -25.0 && abs(ay - 7.3) < 0.85) return 'trim';
        // Endplates
        if (z >= 14 && z <= 17.2 && abs(ay - 12.3) < 0.85 && x >= -29.0 && x <= -24.0) return 'paintD';
        // Main wing airfoil
        if (z >= 15 && z <= 16 && ay <= 12.2 && x >= -28.8 && x <= -24.2) {
          return abs(ay - 2.3) < 1.1 ? 'stripe' : x < -27.8 ? 'stripe2' : 'paint1';
        }
      }

      // 2. Four Cylindrical Wheels (front x=+17.5, rear x=-17.5, radius 4.4, centered z=4.2)
      const wx = x > 0 ? 17.5 : -17.5;
      const wd = hypot(x - wx, z - 4.2);
      if (ay >= 8.6 && ay <= 13.2 && wd <= 4.35) {
        if (ay >= 11.4 && wd <= 2.35) {
          // Alloy rim + 5-spoke star pattern
          if (wd <= 0.85) return 'paintD';
          const ang = Math.atan2(z - 4.2, x - wx);
          return Math.cos(ang * 5) > 0.15 ? 'alloy' : 'alloyD';
        }
        if (ay >= 12.6 && wd > 3.6) return null; // rounded tire shoulder
        return (floor(x + z) & 1) && wd > 3.5 ? 'tireTread' : 'tire';
      }

      // Carve wheel arches out of fenders cleanly
      if (ay >= 8.6 && wd <= 5.3 && z <= 7.8) return null;

      // 3. Exhaust pipes sticking out rear
      if (x <= -28.2 && x >= -30.6 && z >= 2 && z <= 3.6 && hypot(ay - 5.6, z - 2.8) <= 1.05) {
        return x < -29.8 ? 'grille' : 'steel';
      }

      // 4. Side mirrors (x=6.5..9.0, ay=12.2..14.8, z=11.5..13.2)
      if (x >= 6.4 && x <= 9.0 && z >= 11.4 && z <= 13.3 && ay >= 12.0 && ay <= 14.8) {
        if (z < 12.2 && ay > 13.0) return null;
        return ay > 13.0 ? 'paintD' : 'trim';
      }

      // 5. Ground clearance
      if (z < 2) return null;

      // Nose & tail planform taper
      let halfW = 12.5;
      if (x > 25) halfW = 12.5 - (x - 25) * 0.45;
      else if (x < -25) halfW = 12.5 - (-25 - x) * 0.4;
      // Widebody fender flares around front & rear axles
      if (abs(x - 17.5) < 6.0 || abs(x + 17.5) < 6.0) halfW = max(halfW, 13.4);

      if (x > 29.4 || x < -29.2 || ay > halfW) return null;

      // Front splitter lip (z=2)
      if (z === 2 && x > 26.5 && ay <= halfW - 0.5) return 'trim';
      if (x > 28.4 && z > 7.8) return null;

      // 6. Lower Body (z = 2..11)
      // Hood slope in front (x from 10 to 29 drops from z=11.2 down to z=7.5)
      let bodyTop = 11.2;
      if (x > 10) bodyTop = 11.2 - (x - 10) * 0.19;
      if (x > 26) bodyTop -= (x - 26) * 0.45;
      // Slight rear ducktail lift
      if (x < -20 && x >= -28.5) bodyTop = 11.2 + (-20 - x) * 0.08;

      if (z <= bodyTop) {
        // Fender flare dark lip right above wheel well
        if (ay >= 11.8 && wd <= 6.2 && wd > 5.2 && z <= 8.5) return 'trim';

        // Front bumper: grille, intercooler & quad headlights
        if (x >= 27.6) {
          if (z <= 3) return 'trim';
          if (z >= 3 && z <= 5.2 && ay < 5.6) return (floor(z) & 1) ? 'steel' : 'grille';
          if (z >= 5.6 && z <= 7.8 && ay >= 5.8 && ay <= 10.6) return 'headlight';
          if (z >= 5.6 && z <= 7.4 && ay < 5.8) return 'grille';
        }

        // Rear bumper: diffuser, plate, wide LED taillights
        if (x <= -27.4) {
          if (z <= 3.6 && ay < 9.5) return 'trim';
          if (z >= 7.0 && z <= 9.2) {
            if (ay >= 5.2 && ay <= 10.8) return 'taillight';
            if (ay < 4.2 && z >= 7.2 && z <= 8.6) return 'plate';
            return 'trim';
          }
        }

        // Hood vents (x=13..20, ay=3.6..7.2)
        if (z >= bodyTop - 1.1 && x >= 13 && x <= 20 && ay >= 3.8 && ay <= 7.0) {
          return (floor(x) % 2 === 0) ? 'grille' : 'trim';
        }

        // Twin racing stripes along hood & trunk
        if (z >= bodyTop - 1.0 && abs(ay - 2.3) < 1.15 && x < 28) return 'stripe';

        // Lower rocker trim & side accent stripe
        if (z === 2) return 'trim';
        if (z === 5 && ay > halfW - 1.2 && x > -25 && x < 25) return 'stripe2';
        if (ay > halfW - 1.1 && abs(x - 2) < 0.6 && z > 3 && z < 10) return 'paintD'; // door seam
        if (ay > halfW - 1.1 && x >= -4.5 && x <= -2.0 && z === 9) return 'trim';   // door handle

        return z <= 3 ? 'paintD' : carPaint(x, y, z);
      }

      // 7. Cabin / Fastback Greenhouse (z = 11.2 .. 18.2)
      // X span shrinks smoothly from bottom (x=-23..10.5) to roof (x=-10..1.5)
      const hFrac = (z - 11.0) / 7.2;
      if (hFrac < 0 || hFrac > 1.02) return null;

      const cabFront = 10.5 - hFrac * 9.5;  // 10.5 -> 1.0
      const cabBack = -23.0 + hFrac * 13.0; // -23.0 -> -10.0
      const cabW = 10.8 - hFrac * 2.3;      // 10.8 -> 8.5

      if (x > cabFront || x < cabBack || ay > cabW) return null;

      // Roof cap (top 2 layers)
      if (z >= 17) {
        if (ay > cabW - 1.1 || x > cabFront - 1.1 || x < cabBack + 1.1) return 'paintD';
        if (abs(ay - 2.3) < 1.15) return 'stripe';
        return carPaint(x, y, z);
      }

      // Pillars (A-pillar front corners, B-pillar middle, C-pillar rear corners)
      const inA = (x > cabFront - 1.6) && (ay > cabW - 1.6);
      const inB = (abs(x + 2.5) < 0.9) && (ay > cabW - 1.2);
      const inC = (x < cabBack + 2.0) && (ay > cabW - 1.8);
      if (inA || inB || inC) return 'trim';

      // Front windshield
      if (x > cabFront - 1.6 && ay <= cabW - 1.6) return (z > 15.5) ? 'glass' : 'glassD';

      // Rear fastback window with louvers
      if (x < cabBack + 2.0 && ay <= cabW - 1.8) return (floor(z) % 2 === 0) ? 'trim' : 'glassD';

      // Side windows
      if (ay > cabW - 1.2) return (z > 15) ? 'glass' : 'glassD';

      // Hollow interior (seats + dashboard visible when dismantling!)
      if (z < 14.5 && abs(ay - 4.0) < 2.2 && x > -8 && x < -1) return 'seat';
      if (z < 13.5 && x > 3 && x < 7 && ay < cabW - 1.6) return 'trim';
      return null;
    }
  };

  // ---------------------------------------------------------------- Corner Garage & Street Props
  const garage = {
    name: 'garage', w: 66, h: 34, layers: 28,
    fn: function (x, y, z) {
      const ax = abs(x), ay = abs(y);
      // Roof & overhang
      if (z >= 22) {
        if (z > 25) {
          // Roof AC unit + glowing TURBO sign on front parapet
          if (x > -24 && x < -12 && y > -6 && y < 4 && z < 28) return 'conc2';
          if (y < -14 && z >= 25 && z <= 28 && ax < 14) {
            if (y < -15.2) return (floor((x + 14) / 3) & 1) ? 'neonPink' : 'neonCyan';
            return 'trim';
          }
          return null;
        }
        if (ax > 32 || ay > 16.5) return null;
        if (z === 24 && (ax > 30.5 || ay > 15.0)) return 'conc1';
        return (floor(x / 4) & 1) ? 'roof1' : 'roof2';
      }
      if (ax > 31 || ay > 15) return null;
      const onBack = y > 13.5, onFront = y < -13.5, onSide = ax > 29.5;
      // Front face (-y): two garage bays with rolled-up doors & office window
      if (onFront) {
        // Left bay open (x in [-24, -6], z < 16)
        if (x > -24 && x < -6 && z < 17) {
          if (z >= 14) return (z & 1) ? 'doorM' : 'doorM2';
          return null;
        }
        // Right bay closed roller door (x in [-2, +14], z < 17)
        if (x > -2 && x < 14 && z < 17) return (z & 1) ? 'doorM' : 'doorM2';
        // Office window (x in [18, 26], z in [7, 14])
        if (x > 18 && x < 26 && z >= 7 && z <= 14) return 'winLit';
      }
      if (!onBack && !onFront && !onSide) {
        // Interior bench & shelves
        if (y > 9 && z < 6 && ax < 26) return z === 5 ? 'wood1' : 'wood2';
        return null;
      }
      if (z < 3) return 'conc2';
      if (z === 21) return 'conc1';
      const row = floor(z / 2), b = hash(floor((x + y + row * 2.2) / 4), row, 8);
      return b < 0.25 ? 'brick3' : b < 0.65 ? 'brick1' : 'brick2';
    }
  };

  const streetLamp = {
    name: 'streetLamp', w: 12, h: 12, layers: 36, noShadow: false,
    shadowIf: (x, y, z) => z < 32 && hypot(x, y) < 1.5,
    fn: function (x, y, z) {
      if (z < 3 && hypot(x, y) < 2.2) return 'iron';
      if (z < 33 && hypot(x, y) < 1.0) return 'iron';
      if (z >= 32 && z <= 34 && x >= 0 && x <= 5 && abs(y) < 0.8) return 'iron';
      if (z >= 30 && z <= 32 && x >= 3.2 && x <= 5.4 && abs(y) < 1.2) return 'lampBulb';
      return null;
    }
  };

  const cone = {
    name: 'cone', w: 6, h: 6, layers: 7, noShadow: true,
    fn: function (x, y, z) {
      if (z === 0 && abs(x) <= 2.2 && abs(y) <= 2.2) return 'coneO';
      const r = 2.0 - z * 0.26;
      if (hypot(x, y) > r) return null;
      return (z === 3 || z === 4) ? 'coneW' : 'coneO';
    }
  };

  const tireStack = {
    name: 'tireStack', w: 10, h: 10, layers: 9,
    fn: function (x, y, z) {
      const ox = z >= 6 ? 0.8 : z >= 3 ? -0.5 : 0;
      const d = hypot(x - ox, y);
      return d <= 3.8 && d >= 1.5 ? ((z % 3 === 0) ? 'tireTread' : 'tire') : null;
    }
  };

  const oilDrums = {
    name: 'oilDrums', w: 14, h: 10, layers: 8,
    fn: function (x, y, z) {
      if (hypot(x + 3.2, y - 0.8) <= 2.6) return (z === 0 || z === 4 || z === 7) ? 'steel' : 'drumR';
      if (hypot(x - 3.2, y + 1.0) <= 2.6) return (z === 0 || z === 4 || z === 7) ? 'steel' : 'drumB';
      return null;
    }
  };

  const tree = {
    name: 'tree', w: 26, h: 26, layers: 32, soft: 0.45,
    shadowIf: (x, y, z) => z < 12 ? hypot(x, y) < 2.5 : hypot(x, y) < 9.5,
    fn: function (x, y, z) {
      if (z < 12 && hypot(x, y) < 2.2 - z * 0.06) return 'trunk';
      if (z >= 10) {
        const d = hypot(x, y, (z - 20) * 1.15);
        const q = n3(x * 0.28, y * 0.28, z * 0.28, 99);
        if (d < 9.5 + (q - 0.5) * 4.2) {
          return q > 0.62 ? 'leaf2' : q < 0.34 ? 'leaf3' : 'leaf1';
        }
      }
      return null;
    }
  };

  function stacks() {
    const list = [];
    for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) list.push(makeGroundTile(tx, ty));
    list.push(turbo86, garage, streetLamp, cone, tireStack, oilDrums, tree);
    return list;
  }

  function layout() {
    const L = [];
    for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) {
      L.push({ n: `ground_${tx}_${ty}`, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, z: 0, rot: 0, scale: 1 });
    }
    // Garage on north apron
    L.push({ n: 'garage', x: 66, y: 24, z: 2, rot: 0, scale: 1, tag: 'garage' });
    // Streetlamp by the curb illuminating the road and car
    L.push({ n: 'streetLamp', x: 34, y: 46, z: 2, rot: -Math.PI / 2, scale: 1 });
    // Props around garage & park
    L.push({ n: 'tireStack', x: 38, y: 38, z: 2, rot: 0.2, scale: 1 });
    L.push({ n: 'oilDrums', x: 93, y: 38, z: 2, rot: 0.4, scale: 1 });
    L.push({ n: 'cone', x: 48, y: 51, z: 1, rot: 0, scale: 1 });
    L.push({ n: 'cone', x: 96, y: 51, z: 1, rot: 0, scale: 1 });
    L.push({ n: 'tree', x: 24, y: 120, z: 1, rot: 0.3, scale: 1, sway: 0.015 });
    L.push({ n: 'tree', x: 118, y: 122, z: 1, rot: 2.1, scale: 0.9, sway: 0.015 });

    // The star of the diorama: TURBO-86 parked at the center of the road!
    L.push({ n: 'turbo86', x: 72, y: 74, z: 1, rot: -0.22, scale: 0.68, tag: 'car' });
    return L;
  }

  // Time-of-day lighting (0 = crisp afternoon, 0.55 = golden hour, 1.0 = neon night)
  function light(t) {
    const K = [
      { t: 0, el: 40, az: -42, sun: [1.38, 1.24, 1.0], sky: [0.42, 0.50, 0.66], bounce: [0.30, 0.26, 0.18], haze: [0.85, 0.88, 0.94], hazeK: 0.15, glow: 0.05, exposure: 1.02 },
      { t: 0.55, el: 16, az: -20, sun: [1.55, 1.00, 0.52], sky: [0.36, 0.38, 0.62], bounce: [0.32, 0.22, 0.15], haze: [0.95, 0.74, 0.58], hazeK: 0.28, glow: 0.48, exposure: 1.05 },
      { t: 1.0, el: 6, az: 10, sun: [0.55, 0.42, 0.68], sky: [0.22, 0.24, 0.42], bounce: [0.16, 0.12, 0.18], haze: [0.24, 0.22, 0.36], hazeK: 0.32, glow: 1.0, exposure: 1.15 }
    ];
    t = max(0, min(1, t));
    const b = t < K[1].t ? 1 : 2, A = K[b - 1], B = K[b];
    let u = (t - A.t) / (B.t - A.t);
    u = u * u * (3 - 2 * u);
    const mix = (k) => typeof A[k] === 'number' ? A[k] + (B[k] - A[k]) * u : A[k].map((v, i) => v + (B[k][i] - v) * u);
    const el = mix('el') * Math.PI / 180, az = mix('az') * Math.PI / 180;
    return {
      t, sun: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
      sunCol: mix('sun'), skyCol: mix('sky'), bounceCol: mix('bounce'),
      hazeCol: mix('haze'), hazeK: mix('hazeK'), glow: mix('glow'),
      exposure: mix('exposure'), outer: [0.16, 0.20, 0.28], cloud: 0
    };
  }

  global.CarScene = { WORLD, palette, stacks, layout, light };
})(typeof window !== 'undefined' ? window : globalThis);
