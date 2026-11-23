// lost_scene.js: Oceanic Flight 815 mid-air breakup diorama ("bullet-time") over a tropical island.
(function (global) {
  'use strict';

  const abs = Math.abs, floor = Math.floor, hypot = Math.hypot, max = Math.max, min = Math.min;
  const sin = Math.sin, cos = Math.cos;
  const hash = Art.hash, noise = Art.noise;
  const n3 = (x, y, z, s) => noise(x + z * 5.1, y - z * 3.9, s);

  const TILE = 48, NX = 3, NY = 3;
  const WORLD = { w: TILE * NX, h: TILE * NY }; // 144 x 144

  function palette() {
    const P = new Art.Palette();
    // Island & Ocean (water index = ocean)
    P.add('ocean', '#1c6d94');
    P.add('oceanDeep', '#144c6e');
    P.add('foam', '#cceef7');
    P.add('sand1', '#e0c68b');
    P.add('sand2', '#cfb174');
    P.add('sandWet', '#9e8454');
    P.add('jungle1', '#2d5c36');
    P.add('jungle2', '#3d7341');
    P.add('jungle3', '#1f4228');
    P.add('rock1', '#6a6e7a');
    P.add('rock2', '#505461');

    // Palms
    P.add('palmTrunk', '#705039');
    P.add('palmLeaf1', '#3f7d3f');
    P.add('palmLeaf2', '#599c49');
    P.add('palmLeaf3', '#29592c');

    // Oceanic 815 Fuselage & Metal
    P.add('fuseWhite', '#dfe5ed');
    P.add('fuseShade', '#aab4c4');
    P.add('fuseBelly', '#7f8a9c');
    P.add('airlineBlue', '#24589c');
    P.add('airlineGold', '#e6a832');
    P.add('metalDark', '#383e4d');
    P.add('metalTear', '#576073');
    P.add('steel', '#9ea9bd');
    P.add('cockpitGlass', '#49a6d4');
    P.add('seatBlue', '#2c4c7a');
    P.add('carpet', '#593d3b');
    P.add('charred', '#22242c');

    // Debris & luggage
    P.add('lugRed', '#c93c3c');
    P.add('lugYellow', '#ebba34');
    P.add('lugTeal', '#2f8c8a');
    P.add('vestOrange', '#f26f29');

    // Emissives (fire, sparks, cabin lights)
    P.add('fireCore', '#fff0a3', 1.0);
    P.add('fireMid', '#ff7b24', 1.0);
    P.add('fireRed', '#d9301e', 0.96);
    P.add('cabinGlow', '#ffd98a', 0.92);
    P.add('sparkBlue', '#70e8ff', 1.0);
    P.add('beaconRed', '#ff2b2b', 0.98);

    // Smoke
    P.add('smokeDark', '#2b2d36');
    P.add('smokeMid', '#484c59');
    P.add('smokeLight', '#6f7587');
    return P;
  }

  // Curved tropical coastline across 144x144 map:
  // Sea on -x / -y side, beach curve through middle, jungle on +x / +y
  function islandHeight(wx, wy) {
    const wave = sin(wx * 0.055) * 8 + cos(wy * 0.048) * 7 + (noise(wx * 0.06, wy * 0.06, 3) - 0.5) * 9;
    return (wx * 0.65 + wy * 0.58) - 82 + wave; // < 0 = ocean, 0..18 = beach, > 18 = jungle
  }

  function makeGroundTile(tx, ty) {
    const ox = tx * TILE + TILE / 2, oy = ty * TILE + TILE / 2;
    return {
      name: `island_${tx}_${ty}`,
      w: TILE, h: TILE, layers: 5, pad: 2, ground: true,
      fn: function (x, y, z) {
        const wx = ox + x, wy = oy + y;
        const d = islandHeight(wx, wy);
        if (d < -1.5) {
          if (z > 0) return null;
          if (d > -4.2 && sin(wx * 0.35 + wy * 0.25) > 0.15) return 'foam';
          return d < -26 ? 'oceanDeep' : 'ocean';
        }
        if (d < 2.2) {
          if (z > 0) return null;
          return d < 0.4 ? 'foam' : 'sandWet';
        }
        if (d < 20) {
          const h = d < 9 ? 1 : 2;
          if (z > h) return null;
          const q = noise(wx * 0.25, wy * 0.25, 13);
          return q > 0.65 ? 'sand2' : 'sand1';
        }
        // Raised jungle floor
        const jh = min(4, 2 + floor((d - 20) / 14));
        if (z > jh) return null;
        if (z === jh && hash(floor(wx), floor(wy), 21) > 0.87) return 'jungle2';
        const jq = noise(wx * 0.22, wy * 0.22, 33);
        return jq > 0.62 ? 'jungle2' : jq < 0.28 ? 'jungle3' : 'jungle1';
      }
    };
  }

  // Helper: rotate point (px, py, pz) around Y (pitch) and X (roll) to sculpt tilted 3D plane parts cleanly
  function rotPitchRoll(x, y, z, pitch, roll) {
    // Pitch around Y: x' = x*cos + z*sin, z' = -x*sin + z*cos
    const cp = cos(pitch), sp = sin(pitch);
    const x1 = x * cp + z * sp;
    const z1 = -x * sp + z * cp;
    // Roll around X: y' = y*cos - z1*sin, z'' = y*sin + z1*cos
    const cr = cos(roll), sr = sin(roll);
    const y2 = y * cr - z1 * sr;
    const z2 = y * sr + z1 * cr;
    return [x1, y2, z2];
  }

  // ---------------------------------------------------------------- Front Fuselage (nose + cockpit + torn mid-cabin)
  const frontFuselage = {
    name: 'frontFuselage',
    w: 58, h: 30, layers: 36,
    noShadow: true,
    fn: function (x, y, z) {
      // Shift z to center around layer 17, then inverse-rotate by pitch=-0.34 (nose down), roll=0.14
      const [lx, ly, lz] = rotPitchRoll(x, y, z - 17, 0.34, -0.14);
      // Local plane coords: lx in [-22, +24] (nose at +24, jagged tear around lx=-16..-21)
      if (lx > 24 || lx < -23) return null;

      // Jagged structural tear on back edge (lx < -14)
      const tearNoise = sin(ly * 0.8 + lz * 0.7) * 2.4 + (n3(ly * 0.5, lz * 0.5, lx * 0.2, 41) - 0.5) * 4.5;
      if (lx < -15.5 + tearNoise) return null;

      // Fuselage radius tapers gracefully at the nose cone (lx > 10)
      let rad = 7.4;
      if (lx > 10) {
        const t = (lx - 10) / 14;
        rad = 7.4 * Math.sqrt(Math.max(0.02, 1 - t * t * 0.94));
      }
      const d = hypot(ly, lz * 0.95);
      if (d > rad) return null;

      const isTearEdge = lx < -13.8 + tearNoise;
      if (isTearEdge) {
        if (d > rad - 1.4) return hash(floor(lx), floor(ly), floor(lz)) > 0.4 ? 'charred' : 'metalTear';
      }

      // Hollow cabin interior! (visible through the open tear AND via X-ray cutaway!)
      if (d < rad - 1.35 && lx < 16) {
        // Cabin floor deck at lz ~ -1.8
        if (lz >= -2.4 && lz <= -1.2) return abs(ly) < 1.3 ? 'carpet' : 'metalDark';
        // Twin rows of airline seats!
        if (lz > -1.2 && lz <= 2.2 && abs(ly) > 1.5 && abs(ly) < rad - 1.8) {
          const seatSpacing = ((floor(lx + 30) % 4) + 4) % 4;
          if (seatSpacing === 0 || (seatSpacing === 1 && lz < 0.6)) return 'seatBlue';
        }
        // Cockpit dashboard / glow near front
        if (lx > 12 && lx < 15.5 && lz > -1 && lz < 2.2) return 'sparkBlue';
        // Overhead bin / loose sparks near tear
        if (isTearEdge && lz > 2.5 && hash(floor(lx), floor(ly), floor(lz)) > 0.72) return 'sparkBlue';
        return null;
      }

      // Outer skin details
      // Cockpit wrap-around windows
      if (lx >= 13.5 && lx <= 18.2 && lz >= 1.0 && lz <= 4.2 && abs(ly) < 4.8) return 'cockpitGlass';
      // Passenger cabin windows along both sides
      if (lx >= -14 && lx <= 10 && lz >= 0.4 && lz <= 2.0 && abs(ly) > rad - 1.5) {
        if ((((floor(lx + 20) % 3) + 3) % 3) === 0) return 'cabinGlow';
      }
      // Oceanic livery blue cheatline + gold stripe
      if (lz >= -1.2 && lz <= 0.3 && lx < 18) return 'airlineBlue';
      if (lz >= 0.3 && lz <= 1.0 && lx < 17) return 'airlineGold';
      // Scorched belly near tear
      if (lx < -9 && lz < -2 && hash(floor(lx), floor(ly), 9) > 0.45) return 'charred';
      if (lz < -2.2) return 'fuseBelly';
      return lz > 2.5 ? 'fuseWhite' : 'fuseShade';
    }
  };

  // ---------------------------------------------------------------- Rear Tail Section (torn mid-back + Oceanic vertical fin)
  const tailSection = {
    name: 'tailSection',
    w: 54, h: 34, layers: 36,
    noShadow: true,
    fn: function (x, y, z) {
      // Tilted upward/rolled opposite to front half!
      const [lx, ly, lz] = rotPitchRoll(x, y, z - 16, -0.30, 0.24);
      if (lx > 22 || lx < -23) return null;

      // Jagged front break edge (lx > 14)
      const tearNoise = cos(ly * 0.9 - lz * 0.6) * 2.5 + (n3(ly * 0.45, lz * 0.45, lx * 0.2, 57) - 0.5) * 4.2;
      if (lx > 14.5 + tearNoise) return null;

      // Vertical Tail Fin (stabilizer) rising at back lx in [-22..-8], lz > 2
      if (lx <= -7 && lx >= -22 && lz >= 2.0 && lz <= 18.0 && abs(ly) <= 1.15) {
        const finFront = -7 - (lz - 2) * 0.72;
        const finBack = -20.5 - (lz - 2) * 0.14;
        if (lx <= finFront && lx >= finBack) {
          if (lz > 15.5) return 'beaconRed'; // tail beacon light
          if (lx < finBack + 2.2) return 'airlineGold';
          if (lz > 7 && lz < 13 && lx > finBack + 2.2) return 'airlineBlue';
          return abs(ly) < 0.6 ? 'fuseWhite' : 'fuseShade';
        }
      }

      // Horizontal stabilizers at back (lx in [-21..-12], lz ~ 0.5, |ly| <= 12)
      if (lx <= -11 && lx >= -22 && abs(lz - 0.5) <= 1.05 && abs(ly) <= 12.5) {
        const sweepFront = -11 - abs(ly) * 0.58;
        const sweepBack = -19.5 - abs(ly) * 0.25;
        if (lx <= sweepFront && lx >= sweepBack) {
          return abs(ly) > 10.5 ? 'airlineBlue' : 'fuseShade';
        }
      }

      // Tapered rear fuselage cone (lx < -6 -> cone to tail tip)
      let rad = 7.3;
      if (lx < -6) {
        const t = (-6 - lx) / 17;
        rad = max(1.2, 7.3 * (1 - t * 0.78));
      }
      const d = hypot(ly, lz * 0.95);
      if (d > rad) return null;

      if (lx > 12.6 + tearNoise && d > rad - 1.4) {
        return hash(floor(lx), floor(ly), floor(lz)) > 0.4 ? 'charred' : 'metalTear';
      }

      // Hollow rear cabin
      if (d < rad - 1.35 && lx > -12) {
        if (lz >= -2.4 && lz <= -1.2) return abs(ly) < 1.3 ? 'carpet' : 'metalDark';
        if (lz > -1.2 && lz <= 2.2 && abs(ly) > 1.5 && abs(ly) < rad - 1.8) {
          const sp = ((floor(lx + 30) % 4) + 4) % 4;
          if (sp === 0 || (sp === 1 && lz < 0.6)) return 'seatBlue';
        }
        return null;
      }

      if (lx >= -10 && lx <= 12 && lz >= 0.4 && lz <= 2.0 && abs(ly) > rad - 1.5) {
        if ((((floor(lx + 20) % 3) + 3) % 3) === 0) return 'cabinGlow';
      }
      if (lz >= -1.2 && lz <= 0.3) return 'airlineBlue';
      if (lz >= 0.3 && lz <= 1.0) return 'airlineGold';
      if (lx > 7 && lz < 0 && hash(floor(lx), floor(ly), 19) > 0.5) return 'charred';
      return lz < -2.2 ? 'fuseBelly' : lz > 2.5 ? 'fuseWhite' : 'fuseShade';
    }
  };

  // ---------------------------------------------------------------- Swept Wings + Jet Engines (Left & Right)
  function makeWing(side) {
    // side = +1 (right/starboard - burning engine!) or -1 (left/port)
    return {
      name: side > 0 ? 'wingR' : 'wingL',
      w: 36, h: 36, layers: 26,
      noShadow: true,
      fn: function (x, y, z) {
        const [lx, ly, lz] = rotPitchRoll(x, y, z - 12, 0.34, -0.14);
        const span = ly * side; // 0 (root) -> +17 (wingtip)
        if (span < -1 || span > 17) return null;

        // Under-wing jet turbine pod at span in [4.5..8.5], lx in [0..10], lz in [-5.8..-1.2]
        const ed = hypot(span - 6.5, lz + 3.4);
        if (lx >= -1 && lx <= 10.5 && ed <= 2.55) {
          if (ed > 1.75 || lx > 8.5 || lx < 0.5) {
            if (side > 0 && lx < 1.5 && ed < 2.2) return 'fireCore'; // burning exhaust!
            if (side > 0 && hash(floor(lx), floor(ly), floor(lz)) > 0.6) return 'charred';
            return lx > 9.4 ? 'airlineBlue' : 'metalDark';
          }
          if (lx > 7.5 && ed < 1.6) return side > 0 ? 'fireMid' : 'steel';
          return null;
        }

        // Fire plume right on the damaged starboard engine!
        if (side > 0 && lx >= -10 && lx <= 2 && hypot(span - 6.5, lz + 3.0) <= 3.2 - (-lx) * 0.14) {
          const q = n3(lx * 0.5, ly * 0.5, lz * 0.5, 88);
          if (q > 0.62) return 'fireCore';
          if (q > 0.36) return 'fireMid';
          if (q > 0.16) return 'fireRed';
        }

        // Swept wing airfoil
        const leadX = 9.0 - span * 0.72;
        const trailX = -4.5 - span * 0.42;
        const wingZ = span * 0.10; // dihedral
        if (lx <= leadX && lx >= trailX && abs(lz - wingZ) <= 0.95) {
          if (span > 15.6 && lz > wingZ) return side > 0 ? 'beaconRed' : 'sparkBlue'; // wingtip nav light
          if (lx < trailX + 1.4) return 'metalDark';
          return lz > wingZ ? 'fuseWhite' : 'fuseShade';
        }
        return null;
      }
    };
  }

  // ---------------------------------------------------------------- Floating Debris & Smoke Puffs
  const luggage = {
    name: 'luggage', w: 8, h: 8, layers: 6, noShadow: true,
    fn: function (x, y, z) {
      if (abs(x) <= 2.4 && abs(y) <= 1.6 && z >= 0 && z <= 3.5) {
        if (z === 3 && abs(x) < 0.8 && abs(y) < 0.6) return 'metalDark';
        return abs(x) > 1.8 ? 'metalDark' : 'lugRed';
      }
      return null;
    }
  };

  const luggageYellow = {
    name: 'luggageYellow', w: 8, h: 8, layers: 6, noShadow: true,
    fn: function (x, y, z) {
      if (abs(x) <= 2.2 && abs(y) <= 1.8 && z >= 0 && z <= 3.2) {
        return abs(y) > 1.2 ? 'charred' : 'lugYellow';
      }
      return null;
    }
  };

  const seatDebris = {
    name: 'seatDebris', w: 8, h: 8, layers: 8, noShadow: true,
    fn: function (x, y, z) {
      if (abs(y) > 2.2) return null;
      if (z <= 2 && abs(x) <= 2.2) return z === 0 ? 'metalDark' : 'seatBlue';
      if (z > 2 && z <= 6 && x >= -2.2 && x <= -0.8) return 'seatBlue';
      return null;
    }
  };

  const metalScrap = {
    name: 'metalScrap', w: 10, h: 10, layers: 5, noShadow: true,
    fn: function (x, y, z) {
      const q = n3(x * 0.5, y * 0.5, z * 0.5, 31);
      if (hypot(x, y) < 3.6 + q && abs(z - 2) <= 0.7) {
        return q > 0.6 ? 'airlineBlue' : q < 0.3 ? 'charred' : 'fuseShade';
      }
      return null;
    }
  };

  const smokePuff = {
    name: 'smokePuff', w: 16, h: 16, layers: 16, noShadow: true, soft: 0.7,
    fn: function (x, y, z) {
      const d = hypot(x, y, z - 7.5);
      const q = n3(x * 0.35, y * 0.35, z * 0.35, 105);
      if (d < 5.2 + (q - 0.5) * 3.5) {
        return q > 0.65 ? 'smokeLight' : q < 0.32 ? 'smokeDark' : 'smokeMid';
      }
      return null;
    }
  };

  const firePuff = {
    name: 'firePuff', w: 12, h: 12, layers: 12, noShadow: true, soft: 0.8,
    fn: function (x, y, z) {
      const d = hypot(x, y, z - 5.5);
      const q = n3(x * 0.45, y * 0.45, z * 0.45, 73);
      if (d < 3.8 + (q - 0.5) * 2.5) {
        if (d < 2.1) return 'fireCore';
        return q > 0.5 ? 'fireMid' : 'fireRed';
      }
      return null;
    }
  };

  const palmTree = {
    name: 'palmTree', w: 22, h: 22, layers: 32, soft: 0.5,
    shadowIf: (x, y, z) => z < 20 ? hypot(x, y) < 2.2 : hypot(x, y) < 8.5,
    fn: function (x, y, z) {
      // Curved tropical palm trunk
      const bendX = sin(z * 0.08) * 2.2;
      if (z < 24 && hypot(x - bendX, y) < 1.65 - z * 0.025) return 'palmTrunk';
      // 6 arching palm fronds at top z=22..30
      if (z >= 21 && z <= 30) {
        const cx = x - sin(23 * 0.08) * 2.2;
        const r = hypot(cx, y);
        if (r > 0.8 && r < 9.8) {
          const ang = Math.atan2(y, cx);
          const frond = abs(sin(ang * 3.0)); // 6 fronds
          const droopZ = 25.5 - r * 0.35 + frond * 1.2;
          if (frond < 0.42 && abs(z - droopZ) <= 1.15) {
            return r > 7 ? 'palmLeaf3' : frond < 0.18 ? 'palmLeaf2' : 'palmLeaf1';
          }
        }
      }
      return null;
    }
  };

  const rock = {
    name: 'rock', w: 12, h: 12, layers: 8,
    fn: function (x, y, z) {
      const q = n3(x * 0.35, y * 0.35, z * 0.4, 51);
      const d = hypot(x * 0.9, y * 1.1, z * 1.3);
      return d < 4.2 + (q - 0.5) * 2.4 ? (q > 0.55 ? 'rock1' : 'rock2') : null;
    }
  };

  function stacks() {
    const list = [];
    for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) list.push(makeGroundTile(tx, ty));
    list.push(
      frontFuselage, tailSection, makeWing(1), makeWing(-1),
      luggage, luggageYellow, seatDebris, metalScrap,
      smokePuff, firePuff, palmTree, rock
    );
    return list;
  }

  function layout() {
    const L = [];
    for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) {
      L.push({ n: `island_${tx}_${ty}`, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, z: 0, rot: 0, scale: 1 });
    }

    // Palm trees & rocks along the jungle edge and beach
    const palms = [
      [88, 108, 0.3, 1.05], [104, 92, 1.8, 0.95], [118, 115, 2.7, 1.1],
      [76, 124, 4.1, 0.9], [126, 76, 5.2, 1.0], [112, 62, 0.9, 0.88],
      [62, 128, 2.2, 1.0], [130, 96, 3.6, 1.05]
    ];
    palms.forEach(([x, y, rot, sc]) => {
      L.push({ n: 'palmTree', x, y, z: 2, rot, scale: sc, sway: 0.028 });
    });
    [[54, 86, 0.4, 1.1], [44, 108, 1.7, 0.9], [95, 56, 2.4, 1.0], [18, 118, 0.9, 1.2]].forEach(([x, y, rot, sc]) => {
      L.push({ n: 'rock', x, y, z: 0, rot, scale: sc });
    });

    // Mid-air breakup centerpiece (Oceanic 815 frozen mid-fall!)
    // Center of breakup around (66, 72), hovering at z=22..36
    L.push({ n: 'frontFuselage', x: 76, y: 66, z: 22, rot: -0.45, scale: 0.95, tag: 'front', baseX: 76, baseY: 66, baseZ: 22, baseRot: -0.45 });
    L.push({ n: 'wingR', x: 76, y: 66, z: 24.5, rot: -0.45, scale: 0.95, tag: 'wingR', baseX: 76, baseY: 66, baseZ: 24.5, baseRot: -0.45 });
    L.push({ n: 'wingL', x: 76, y: 66, z: 24.5, rot: -0.45, scale: 0.95, tag: 'wingL', baseX: 76, baseY: 66, baseZ: 24.5, baseRot: -0.45 });
    L.push({ n: 'tailSection', x: 48, y: 80, z: 34, rot: -0.18, scale: 0.95, tag: 'tail', baseX: 48, baseY: 80, baseZ: 34, baseRot: -0.18 });

    // Suspended debris ring between the two torn halves (bullet-time floating objects!)
    const debrisSpecs = [
      ['luggage',       63, 72, 34, 0.5, 0.75,  1.2,  0.4,  0.6],
      ['luggageYellow', 59, 68, 38, 1.8, 0.75, -0.9,  0.7, -0.4],
      ['seatDebris',    65, 76, 31, 2.4, 0.85,  0.6, -0.8,  0.5],
      ['seatDebris',    57, 75, 36, 0.9, 0.80, -1.1,  0.5,  0.8],
      ['metalScrap',    62, 73, 41, 1.1, 0.85,  0.8,  0.6, -0.5],
      ['metalScrap',    68, 64, 36, 2.9, 0.75, -0.7, -0.6,  0.7],
      ['luggage',       54, 79, 32, 3.3, 0.70,  1.0,  0.3, -0.8],
      ['luggageYellow', 67, 78, 28, 0.2, 0.75, -0.6,  0.9,  0.4],
      ['metalScrap',    60, 65, 30, 4.1, 0.80,  0.9, -0.5,  0.3],
    ];
    debrisSpecs.forEach(([n, x, y, z, rot, sc, vx, vy, vz], idx) => {
      L.push({
        n, x, y, z, rot, scale: sc,
        tag: 'debris', idx,
        baseX: x, baseY: y, baseZ: z, baseRot: rot,
        vx, vy, vz
      });
    });

    // Fireballs & trailing smoke plume from the torn cabin and burning right engine
    const smokeSpecs = [
      ['firePuff',  72, 73, 30, 0.95, 0],
      ['firePuff',  63, 73, 35, 0.75, 1],
      ['smokePuff', 68, 76, 34, 0.95, 2],
      ['smokePuff', 62, 81, 38, 1.15, 3],
      ['smokePuff', 55, 86, 42, 1.35, 4],
      ['smokePuff', 47, 90, 46, 1.55, 5],
      ['smokePuff', 58, 75, 39, 0.95, 6],
      ['smokePuff', 50, 81, 44, 1.25, 7],
    ];
    smokeSpecs.forEach(([n, x, y, z, sc, idx]) => {
      L.push({
        n, x, y, z, rot: idx * 0.9, scale: sc,
        tag: n === 'firePuff' ? 'fire' : 'smoke', idx,
        baseX: x, baseY: y, baseZ: z, baseScale: sc
      });
    });

    return L;
  }

  // Atmospheric lighting: tropical afternoon -> fiery storm sunset -> night crash
  function light(t, flash = 0) {
    const K = [
      { t: 0, el: 42, az: -35, sun: [1.35, 1.22, 1.00], sky: [0.44, 0.56, 0.72], bounce: [0.34, 0.30, 0.20], haze: [0.82, 0.88, 0.95], hazeK: 0.16, glow: 0.25, exposure: 1.0 },
      { t: 0.55, el: 17, az: -18, sun: [1.58, 0.96, 0.48], sky: [0.34, 0.38, 0.62], bounce: [0.34, 0.22, 0.14], haze: [0.94, 0.68, 0.50], hazeK: 0.30, glow: 0.65, exposure: 1.04 },
      { t: 1.0, el: 7, az: 12, sun: [0.44, 0.38, 0.68], sky: [0.18, 0.22, 0.40], bounce: [0.14, 0.12, 0.20], haze: [0.16, 0.18, 0.30], hazeK: 0.34, glow: 1.0, exposure: 1.15 }
    ];
    t = max(0, min(1, t));
    const b = t < K[1].t ? 1 : 2, A = K[b - 1], B = K[b];
    let u = (t - A.t) / (B.t - A.t);
    u = u * u * (3 - 2 * u);
    const mix = (k) => typeof A[k] === 'number' ? A[k] + (B[k] - A[k]) * u : A[k].map((v, i) => v + (B[k][i] - v) * u);
    const el = mix('el') * Math.PI / 180, az = mix('az') * Math.PI / 180;
    const sunCol = mix('sun'), skyCol = mix('sky'), hazeCol = mix('haze');
    if (flash > 0.01) {
      sunCol[0] += flash * 1.4; sunCol[1] += flash * 1.6; sunCol[2] += flash * 2.2;
      skyCol[0] += flash * 0.5; skyCol[1] += flash * 0.7; skyCol[2] += flash * 1.1;
      hazeCol[0] += flash * 0.4; hazeCol[1] += flash * 0.5; hazeCol[2] += flash * 0.7;
    }
    return {
      t, sun: [cos(el) * cos(az), cos(el) * sin(az), sin(el)],
      sunCol, skyCol, bounceCol: mix('bounce'),
      hazeCol, hazeK: mix('hazeK'), glow: mix('glow'),
      exposure: mix('exposure'), outer: [0.12, 0.28, 0.40], cloud: 0.35
    };
  }

  global.LostScene = { WORLD, palette, stacks, layout, light };
})(typeof window !== 'undefined' ? window : globalThis);
