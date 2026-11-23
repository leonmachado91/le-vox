// arena_scene.js: Twin-stick isometric shooter assets, arena tiles, collision obstacles, and animated characters.
(function (global) {
  'use strict';

  const abs = Math.abs, floor = Math.floor, hypot = Math.hypot, min = Math.min, max = Math.max;
  const hash = Art.hash, noise = Art.noise;
  const ell = (x, y, rx, ry) => (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;

  const TILE = 48, NX = 3, NY = 3;
  const WORLD = { w: TILE * NX, h: TILE * NY }; // 144 x 144

  // Playable arena bounds & solid AABB obstacles (used for BOTH visuals/heightmap AND player/bullet collision!)
  const BOUNDS = { minX: 12, maxX: 132, minY: 12, maxY: 132 };
  const OBSTACLES = [
    // 4 heavy cover crates around center
    { kind: 'crate', x: 46, y: 46, hw: 5.2, hh: 5.2, h: 9 },
    { kind: 'crate', x: 98, y: 46, hw: 5.2, hh: 5.2, h: 9 },
    { kind: 'crate', x: 46, y: 98, hw: 5.2, hh: 5.2, h: 9 },
    { kind: 'crate', x: 98, y: 98, hw: 5.2, hh: 5.2, h: 9 },
    // 4 neon energy pillars mid-outer
    { kind: 'pillar', x: 72, y: 32, hw: 3.8, hh: 3.8, h: 20 },
    { kind: 'pillar', x: 72, y: 112, hw: 3.8, hh: 3.8, h: 20 },
    { kind: 'pillar', x: 32, y: 72, hw: 3.8, hh: 3.8, h: 20 },
    { kind: 'pillar', x: 112, y: 72, hw: 3.8, hh: 3.8, h: 20 },
  ];

  function palette() {
    const P = new Art.Palette();
    // Arena floor & industrial walls
    P.add('floor1', '#212636');
    P.add('floor2', '#282e42');
    P.add('floorGrid', '#313952');
    P.add('hazardY', '#e8aa35');
    P.add('hazardB', '#1a1d29');
    P.add('wall1', '#384059');
    P.add('wall2', '#2b3145');
    P.add('wallTop', '#4e5878');

    // Crates & pillars
    P.add('crate1', '#6e523d');
    P.add('crate2', '#523c2c');
    P.add('crateSteel', '#7b87a1');
    P.add('pillarBody', '#2a3042');
    P.add('neonCyan', '#4ff2ff', 0.96);
    P.add('neonPink', '#ff4785', 0.96);

    // Explosive barrel & pickups
    P.add('barrelR', '#cf3636');
    P.add('barrelD', '#8c2024');
    P.add('barrelStripe', '#ffd24a');
    P.add('hpGreen', '#47f589', 1.0);
    P.add('overdriveGold', '#ffe052', 1.0);

    // Player (Tactical Runner)
    P.add('suitBlue', '#2f65ad');
    P.add('suitDark', '#1c3254');
    P.add('armor', '#cfd8e8');
    P.add('skin', '#eab896');
    P.add('boots', '#232633');
    P.add('gunMetal', '#444c63');
    P.add('visorCyan', '#5ef5ff', 1.0);

    // Enemies
    P.add('botRed', '#d93848');
    P.add('botDark', '#4a1b27');
    P.add('botEye', '#ffeb57', 1.0);
    P.add('brutePurple', '#7038a8');
    P.add('bruteDark', '#3c1d5e');
    P.add('bruteCore', '#ff479e', 1.0);
    P.add('sniperTeal', '#2a8c82');
    P.add('sniperEye', '#6bffcb', 1.0);

    // Projectiles & FX
    P.add('bulletCyan', '#8cfaff', 1.0);
    P.add('bulletGold', '#ffdc5c', 1.0);
    P.add('bulletEnemy', '#ff4a68', 1.0);
    P.add('fireCore', '#fff4ad', 1.0);
    P.add('fireMid', '#ff7726', 1.0);
    P.add('smoke', '#424657');
    return P;
  }

  function makeFloorTile(tx, ty) {
    const ox = tx * TILE + TILE / 2, oy = ty * TILE + TILE / 2;
    return {
      name: `arena_${tx}_${ty}`,
      w: TILE, h: TILE, layers: 10, pad: 2, ground: true,
      fn: function (x, y, z) {
        const wx = ox + x, wy = oy + y;
        // Outer perimeter walls (outside 12..132)
        const out = wx < BOUNDS.minX || wx > BOUNDS.maxX || wy < BOUNDS.minY || wy > BOUNDS.maxY;
        if (out) {
          const edgeDist = max(
            max(BOUNDS.minX - wx, wx - BOUNDS.maxX),
            max(BOUNDS.minY - wy, wy - BOUNDS.maxY)
          );
          if (edgeDist > 8) return null;
          if (z > 8) return null;
          if (z === 8) return 'wallTop';
          if (z === 5 && edgeDist < 1.5 && ((floor(wx + wy) % 12 + 12) % 12) < 5) return 'neonCyan';
          return (floor(wx / 6 + wy / 6) & 1) ? 'wall1' : 'wall2';
        }
        if (z > 0) return null;
        // Hazard border inside arena
        const nearWall = min(min(wx - BOUNDS.minX, BOUNDS.maxX - wx), min(wy - BOUNDS.minY, BOUNDS.maxY - wy));
        if (nearWall < 2.2) return (floor((wx + wy) * 0.45) & 1) ? 'hazardY' : 'hazardB';
        // Center arena ring
        const dc = hypot(wx - 72, wy - 72);
        if (abs(dc - 20) < 0.8) return 'floorGrid';
        // Industrial tile grid
        const gx = ((floor(wx) % 12) + 12) % 12;
        const gy = ((floor(wy) % 12) + 12) % 12;
        if (gx === 0 || gy === 0) return 'floorGrid';
        const q = noise(wx * 0.35, wy * 0.35, 7);
        return q > 0.62 ? 'floor2' : 'floor1';
      }
    };
  }

  const crate = {
    name: 'crate', w: 12, h: 12, layers: 10,
    fn: function (x, y, z) {
      if (abs(x) > 5.0 || abs(y) > 5.0 || z > 8) return null;
      const edge = abs(x) > 3.9 || abs(y) > 3.9 || z === 0 || z === 8;
      if (edge) return 'crateSteel';
      return (abs(x - y) < 1.1) ? 'crate2' : 'crate1';
    }
  };

  const pillar = {
    name: 'pillar', w: 10, h: 10, layers: 20,
    fn: function (x, y, z) {
      if (abs(x) > 3.6 || abs(y) > 3.6) return null;
      if (z <= 2 || z >= 18) return 'wallTop';
      if (z >= 13 && z <= 16 && (abs(x) > 2.6 || abs(y) > 2.6)) return 'neonCyan';
      return (abs(x) > 2.7 && abs(y) > 2.7) ? 'wallTop' : 'pillarBody';
    }
  };

  const barrel = {
    name: 'barrel', w: 8, h: 8, layers: 9,
    fn: function (x, y, z) {
      const r = hypot(x, y);
      if (r > 3.0) return null;
      if (z === 0 || z === 8) return 'crateSteel';
      if (z === 4) return 'barrelStripe';
      return r > 2.4 && z === 7 ? 'barrelD' : 'barrelR';
    }
  };

  const pickupHp = {
    name: 'pickupHp', w: 6, h: 6, layers: 6, noShadow: true,
    fn: function (x, y, z) {
      if (abs(x) <= 2 && abs(y) <= 2 && z >= 1 && z <= 4) {
        if (abs(x) < 0.9 || abs(y) < 0.9) return 'hpGreen';
        return 'armor';
      }
      return null;
    }
  };

  const pickupOver = {
    name: 'pickupOver', w: 6, h: 6, layers: 6, noShadow: true,
    fn: function (x, y, z) {
      const d = abs(x) + abs(y) + abs(z - 2.5);
      return d <= 2.6 ? 'overdriveGold' : null;
    }
  };

  const projPlayer = {
    name: 'projPlayer', w: 6, h: 4, layers: 3, noShadow: true,
    fn: function (x, y, z) {
      if (z === 1 && abs(x) <= 2.2 && abs(y) <= 0.9) return x > 0.5 ? 'fireCore' : 'bulletCyan';
      return null;
    }
  };

  const projGold = {
    name: 'projGold', w: 8, h: 4, layers: 3, noShadow: true,
    fn: function (x, y, z) {
      if (z === 1 && abs(x) <= 3.2 && abs(y) <= 0.9) return 'bulletGold';
      return null;
    }
  };

  const projEnemy = {
    name: 'projEnemy', w: 5, h: 5, layers: 4, noShadow: true,
    fn: function (x, y, z) {
      return hypot(x, y, z - 1.5) <= 1.6 ? 'bulletEnemy' : null;
    }
  };

  const fxExplosion = {
    name: 'fxExplosion', w: 14, h: 14, layers: 14, noShadow: true, soft: 0.8,
    fn: function (x, y, z) {
      const d = hypot(x, y, z - 6.5);
      if (d < 2.5) return 'fireCore';
      if (d < 4.8) return 'fireMid';
      if (d < 6.2 && hash(floor(x), floor(y), z) > 0.4) return 'smoke';
      return null;
    }
  };

  const aimRing = {
    name: 'aimRing', w: 8, h: 8, layers: 1, noShadow: true,
    fn: function (x, y) {
      const r = hypot(x, y);
      if ((r >= 2.2 && r <= 3.3) || r <= 0.8) return 'visorCyan';
      return null;
    }
  };

  // ---------------------------------------------------------------- Playable Articulated Runner (Rig.createWalker + aim)
  const playerParts = [
    { name: 'head', w: 12, h: 12, layers: 9, fn: function (x, y, z) {
      const r = z >= 5 ? 4.3 : z === 0 ? 2.5 : 4.1;
      if (x * x + y * y > r * r) return null;
      if (z >= 3 && z <= 5 && x > 2.2 && abs(y) < 3.0) return 'visorCyan';
      if (z >= 6) return 'armor';
      return x > 0.5 && z < 3 ? 'skin' : 'suitDark';
    } },
    { name: 'torso', w: 14, h: 16, layers: 11, fn: function (x, y, z) {
      if (x < -2.2 && x > -5.5 && abs(y) < 3.2 && z >= 3 && z <= 9) return z === 6 ? 'visorCyan' : 'suitDark'; // tech backpack
      if (z <= 1) return ell(x, y, 2.5, 4.0) ? 'suitDark' : null;
      const rx = z >= 8 ? 2.8 : 3.0, ry = z >= 8 ? 6.6 : 4.5 + (z - 2) * 0.35;
      if (!ell(x, y, rx, ry)) return null;
      if (z >= 4 && z <= 8 && x > 1.5 && abs(y) < 3.0) return 'armor';
      return 'suitBlue';
    } },
    { name: 'arm', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 1.7, 1.7) ? 'suitBlue' : null },
    { name: 'hand', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 1.5, 1.5) ? 'armor' : null },
    { name: 'thigh', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 2.3, 2.3) ? 'suitDark' : null },
    { name: 'shin', w: 5, h: 5, layers: 1, fn: (x, y) => ell(x, y, 2.0, 2.0) ? 'suitBlue' : null },
    { name: 'boot', w: 7, h: 5, layers: 3, fn: (x, y, z) => x > -2.2 && x < (z === 2 ? 1.2 : 3.2) && abs(y) < 1.9 ? 'boots' : null },
    { name: 'gun', w: 14, h: 5, layers: 4, fn: function (x, y, z) {
      if (abs(y) > 1.2) return null;
      if (x >= -2 && x <= 6.5 && z >= 1 && z <= 3) {
        if (x > 5.2 && z === 2) return 'visorCyan';
        return z === 3 ? 'armor' : 'gunMetal';
      }
      if (x >= -1.5 && x <= 0.5 && z === 0) return 'gunMetal';
      return null;
    } }
  ];

  const playerCfg = {
    thigh: 7, shin: 7, ankle: 1.5, hipHalf: 2.3, standHip: 13.0, kneeHint: 1,
    stride: 18, duty: 0.56, lift: 2.8, bob: 0.45, twist: 0.14, spine: 9.2,
    arms: true, shoulderHalf: 7.0, upperArm: 4.5, foreArm: 4.5, armSwing: 0.35
  };

  function drawPlayer(R, art, P, aimAngle, recoil) {
    // Legs driven by movement heading (WASD), upper torso + gun aimed at mouse cursor!
    for (let i = 0; i < 2; i++) {
      const L = P.legs[i];
      R.stack(art.boot, L.sole[0], L.sole[1], L.sole[2], L.rot);
      R.limb(art.shin, L.ankle, L.knee, 5);
      R.limb(art.thigh, L.knee, L.hip, 5);
    }
    const T = art.torso, z0 = P.pelvis[2] - 1;
    for (let i = 0; i < T.slices.length; i++) {
      const s = T.slices[i], t = min(1, s.z / (T.n - 2));
      // Blend hip walking angle into aimAngle smoothly at shoulders!
      let diff = ((aimAngle - P.hipsAngle) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      R.slice(T, i, P.x, P.y, z0 + s.z, P.hipsAngle + diff * t);
    }
    R.stack(art.head, P.x, P.y, z0 + T.n, aimAngle);

    // Two-handed aiming pose pointing toward aimAngle
    const c = Math.cos(aimAngle), s = Math.sin(aimAngle);
    const shZ = P.pelvis[2] + playerCfg.spine;
    const gunDist = 8.5 - recoil * 2.2;
    const gunHand = [P.x + c * gunDist, P.y + s * gunDist, shZ - 2.0];
    const shR = [P.x + s * 6.5, P.y - c * 6.5, shZ];
    const shL = [P.x - s * 6.5, P.y + c * 6.5, shZ];
    const elR = [(shR[0] + gunHand[0]) * 0.5 + s * 2.5, (shR[1] + gunHand[1]) * 0.5 - c * 2.5, shZ - 2.4];
    const elL = [(shL[0] + gunHand[0]) * 0.5 - s * 2.5, (shL[1] + gunHand[1]) * 0.5 + c * 2.5, shZ - 2.4];

    R.limb(art.arm, shR, elR, 4); R.limb(art.arm, elR, gunHand, 4);
    R.limb(art.arm, shL, elL, 4); R.limb(art.arm, elL, gunHand, 4);
    R.stack(art.gun, gunHand[0] + c * 1.5, gunHand[1] + s * 1.5, gunHand[2] - 1.2, aimAngle);
  }

  // ---------------------------------------------------------------- Enemy Stacks (3 Distinct Silhouettes)
  const enemyStalker = {
    name: 'enemyStalker', w: 14, h: 14, layers: 16,
    fn: function (x, y, z) {
      if (z <= 3) {
        if (abs(abs(y) - 2.5) < 1.3 && abs(x) < 2.2) return 'botDark';
        return null;
      }
      if (z <= 10) return ell(x, y, 3.6, 4.4) ? (x > 1.8 && z >= 6 ? 'botDark' : 'botRed') : null;
      if (z <= 14) {
        if (!ell(x, y, 3.3, 3.3)) return null;
        if (z === 12 && x > 2.0 && abs(abs(y) - 1.4) < 0.7) return 'botEye';
        return 'botRed';
      }
      return null;
    }
  };

  const enemyBrute = {
    name: 'enemyBrute', w: 20, h: 20, layers: 20,
    fn: function (x, y, z) {
      if (z <= 4 && abs(abs(y) - 4.2) < 2.0 && abs(x) < 3.2) return 'bruteDark';
      if (z > 4 && z <= 14 && ell(x, y, 6.2, 7.6)) {
        if (z >= 8 && z <= 11 && x > 4.2 && abs(y) < 2.2) return 'bruteCore';
        return (abs(y) > 5.5 && z > 10) ? 'armor' : 'brutePurple';
      }
      if (z > 14 && z <= 18 && ell(x, y, 3.8, 4.2)) {
        if (z === 16 && x > 2.5 && abs(y) < 2.4) return 'botEye';
        return 'bruteDark';
      }
      return null;
    }
  };

  const enemyShooter = {
    name: 'enemyShooter', w: 14, h: 14, layers: 18,
    fn: function (x, y, z) {
      if (z < 3) return null; // hovers!
      if (z <= 7 && hypot(x, y) < (z - 2) * 1.1) return 'sniperEye';
      if (z > 7 && z <= 15 && ell(x, y, 4.2, 4.2)) {
        if (z === 12 && x > 2.5 && abs(y) < 2.0) return 'sniperEye';
        return z % 3 === 0 ? 'armor' : 'sniperTeal';
      }
      return null;
    }
  };

  function stacks() {
    const list = [];
    for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) list.push(makeFloorTile(tx, ty));
    list.push(
      crate, pillar, barrel, pickupHp, pickupOver,
      projPlayer, projGold, projEnemy, fxExplosion, aimRing,
      enemyStalker, enemyBrute, enemyShooter
    );
    playerParts.forEach((p) => list.push(Object.assign({}, p, { name: 'pl_' + p.name })));
    return list;
  }

  // Lighting: moody cyberpunk night-dusk where neon, lasers and muzzle flashes pop!
  function light(tod = 0.78) {
    const el = 34 * Math.PI / 180, az = -35 * Math.PI / 180;
    const dusk = max(0, min(1, tod));
    return {
      sun: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
      sunCol: [1.1 - dusk * 0.45, 1.0 - dusk * 0.42, 0.95 - dusk * 0.15],
      skyCol: [0.30, 0.36, 0.56],
      bounceCol: [0.18, 0.15, 0.24],
      hazeCol: [0.12, 0.14, 0.22],
      hazeK: 0.16,
      glow: 0.65 + dusk * 0.35,
      exposure: 1.08,
      outer: [0.09, 0.11, 0.18],
      cloud: 0
    };
  }

  global.ArenaScene = {
    WORLD, BOUNDS, OBSTACLES,
    palette, stacks, light,
    playerCfg, drawPlayer
  };
})(typeof window !== 'undefined' ? window : globalThis);
