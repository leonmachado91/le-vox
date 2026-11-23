// game.js: NEON SECTOR — Twin-stick isometric shooter running on sprite-stack-engine + Rig IK + PostDither.
(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const postCanvas = document.getElementById('post');
  const E = Engine.create(canvas);
  const Dither = PostDither.create(canvas, postCanvas);
  const WORLD = ArenaScene.WORLD;
  const BOUNDS = ArenaScene.BOUNDS;
  const OBSTACLES = ArenaScene.OBSTACLES;

  // Build stacks & atlas
  const pal = ArenaScene.palette();
  const DEFS = ArenaScene.stacks();
  const atlas = new Art.Atlas(2048);
  const S = {};
  DEFS.forEach((d) => { S[d.name] = Art.buildStack(d, pal, atlas, 3); });
  const atlasTex = E.makeAtlas(atlas.data, atlas.size);
  E.setPalette(pal.bytes());

  const playerArt = {
    head: S.pl_head, torso: S.pl_torso, arm: S.pl_arm, hand: S.pl_hand,
    thigh: S.pl_thigh, shin: S.pl_shin, boot: S.pl_boot, gun: S.pl_gun
  };

  // Floor tiles + static crates/pillars
  const staticList = [];
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) {
    staticList.push({ stack: S[`arena_${tx}_${ty}`], x: tx * 48 + 24, y: ty * 48 + 24, z: 0, rot: 0, scale: 1 });
  }
  OBSTACLES.forEach((o) => {
    staticList.push({ stack: S[o.kind], x: o.x, y: o.y, z: 1, rot: 0, scale: 1 });
  });

  // Height map for crisp real-time shadows & AO
  const hm = new Uint8Array(WORLD.w * WORLD.h);
  hm.fill(2);
  for (let y = 0; y < WORLD.h; y++) {
    for (let x = 0; x < WORLD.w; x++) {
      if (x < BOUNDS.minX || x > BOUNDS.maxX || y < BOUNDS.minY || y > BOUNDS.maxY) hm[y * WORLD.w + x] = 18;
    }
  }
  OBSTACLES.forEach((o) => {
    for (let y = Math.floor(o.y - o.hh); y <= Math.ceil(o.y + o.hh); y++) {
      for (let x = Math.floor(o.x - o.hw); x <= Math.ceil(o.x + o.hw); x++) {
        if (x >= 0 && y >= 0 && x < WORLD.w && y < WORLD.h) hm[y * WORLD.w + x] = Math.min(255, (o.h + 1) * 2);
      }
    }
  });
  E.setHeightMap(hm, WORLD.w, WORLD.h);

  // ---------------------------------------------------------------- Tiny Procedural WebAudio SFX
  let audioCtx = null;
  let muted = false;
  function sfx(type) {
    if (muted) return;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    if (type === 'pulse') {
      o.type = 'square'; o.frequency.setValueAtTime(520, now); o.frequency.exponentialRampToValueAtTime(160, now + 0.08);
      g.gain.setValueAtTime(0.06, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      o.start(now); o.stop(now + 0.09);
    } else if (type === 'shotgun') {
      o.type = 'sawtooth'; o.frequency.setValueAtTime(240, now); o.frequency.exponentialRampToValueAtTime(65, now + 0.14);
      g.gain.setValueAtTime(0.09, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      o.start(now); o.stop(now + 0.15);
    } else if (type === 'plasma') {
      o.type = 'triangle'; o.frequency.setValueAtTime(760, now); o.frequency.exponentialRampToValueAtTime(120, now + 0.18);
      g.gain.setValueAtTime(0.09, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      o.start(now); o.stop(now + 0.19);
    } else if (type === 'boom') {
      o.type = 'sawtooth'; o.frequency.setValueAtTime(120, now); o.frequency.exponentialRampToValueAtTime(32, now + 0.34);
      g.gain.setValueAtTime(0.14, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      o.start(now); o.stop(now + 0.35);
    } else if (type === 'hit') {
      o.type = 'triangle'; o.frequency.setValueAtTime(300, now); o.frequency.exponentialRampToValueAtTime(110, now + 0.05);
      g.gain.setValueAtTime(0.05, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      o.start(now); o.stop(now + 0.06);
    } else if (type === 'pickup') {
      o.type = 'sine'; o.frequency.setValueAtTime(520, now); o.frequency.exponentialRampToValueAtTime(980, now + 0.12);
      g.gain.setValueAtTime(0.07, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      o.start(now); o.stop(now + 0.14);
    } else if (type === 'dash') {
      o.type = 'sine'; o.frequency.setValueAtTime(380, now); o.frequency.exponentialRampToValueAtTime(180, now + 0.10);
      g.gain.setValueAtTime(0.06, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
      o.start(now); o.stop(now + 0.11);
    } else if (type === 'hurt') {
      o.type = 'sawtooth'; o.frequency.setValueAtTime(150, now); o.frequency.exponentialRampToValueAtTime(55, now + 0.22);
      g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      o.start(now); o.stop(now + 0.23);
    }
  }

  // ---------------------------------------------------------------- Collision Helpers
  function resolveCircleObstacles(x, y, r) {
    let nx = Math.max(BOUNDS.minX + r, Math.min(BOUNDS.maxX - r, x));
    let ny = Math.max(BOUNDS.minY + r, Math.min(BOUNDS.maxY - r, y));
    for (const o of OBSTACLES) {
      const cx = Math.max(o.x - o.hw, Math.min(o.x + o.hw, nx));
      const cy = Math.max(o.y - o.hh, Math.min(o.y + o.hh, ny));
      const dx = nx - cx, dy = ny - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
          nx = cx + (dx / d) * r;
          ny = cy + (dy / d) * r;
        } else {
          nx += r;
        }
      }
    }
    return [nx, ny];
  }

  function hitsObstacle(x, y, r) {
    if (x < BOUNDS.minX + r || x > BOUNDS.maxX - r || y < BOUNDS.minY + r || y > BOUNDS.maxY - r) return true;
    for (const o of OBSTACLES) {
      if (x + r > o.x - o.hw && x - r < o.x + o.hw && y + r > o.y - o.hh && y - r < o.y + o.hh) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Game State
  const WEAPONS = [
    { id: 1, name: 'Pulse Rifle',     cd: 0.13, speed: 92, dmg: 1, count: 1, spread: 0.04, stack: 'projPlayer', sfx: 'pulse' },
    { id: 2, name: 'Scatter Shotgun', cd: 0.44, speed: 78, dmg: 1, count: 5, spread: 0.36, stack: 'projPlayer', sfx: 'shotgun' },
    { id: 3, name: 'Plasma Cannon',   cd: 0.42, speed: 68, dmg: 3, count: 1, spread: 0.01, stack: 'projGold',   sfx: 'plasma', splash: 9.5 }
  ];

  const PLAYER_SCALE = 0.24; // ~8 units tall matching crates & pillars!
  const cam = { mode: 'ortho', tx: 72, ty: 72, tz: 2, yaw: 0.785, pitch: 0.62, dist: 56, fov: 36 * Math.PI / 180 };

  const G = {
    running: true,
    gameOver: false,
    score: 0,
    wave: 1,
    waveTimer: 0,
    toSpawn: 0,
    spawnCd: 0,
    combo: 0,
    comboTimer: 0,
    shake: 0,
    ditherOn: false,
    dither: 0.45,
    res: 3,
    tod: 0.76,
    player: {
      x: 72, y: 72, hp: 100, maxHp: 100,
      aim: 0, moveYaw: 0, fireCd: 0, recoil: 0, muzzleFlash: 0,
      dashCd: 0, dashTime: 0, dashVx: 0, dashVy: 0, invuln: 0,
      overdrive: 0, weaponIdx: 0,
      walker: Rig.createWalker(ArenaScene.playerCfg)
    },
    aimWorld: [84, 72],
    enemies: [],
    bullets: [],
    barrels: [],
    pickups: [],
    explosions: []
  };

  function spawnBarrels() {
    G.barrels = [];
    [[58, 58], [86, 58], [58, 86], [86, 86], [72, 48], [72, 96]].forEach(([x, y]) => {
      G.barrels.push({ x, y, hp: 2, flash: 0 });
    });
  }

  function startWave(n) {
    G.wave = n;
    G.toSpawn = 5 + n * 4;
    G.spawnCd = 0.5;
    if (n % 2 === 1) spawnBarrels();
  }

  function resetGame() {
    G.gameOver = false;
    G.score = 0;
    G.combo = 0;
    G.comboTimer = 0;
    G.shake = 0;
    G.enemies = [];
    G.bullets = [];
    G.pickups = [];
    G.explosions = [];
    const p = G.player;
    p.x = 72; p.y = 72; p.hp = 100; p.fireCd = 0; p.dashCd = 0; p.dashTime = 0;
    p.invuln = 0.8; p.overdrive = 0; p.recoil = 0;
    Rig.place(p.walker, p.x / PLAYER_SCALE, p.y / PLAYER_SCALE, 0);
    cam.tx = p.x; cam.ty = p.y;
    document.getElementById('gameover').classList.remove('show');
    startWave(1);
  }

  function spawnEnemy() {
    // Pick random perimeter spawn away from player
    let sx = 72, sy = 72;
    for (let tries = 0; tries < 10; tries++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { sx = 18 + Math.random() * 108; sy = 17; }
      else if (side === 1) { sx = 18 + Math.random() * 108; sy = 127; }
      else if (side === 2) { sx = 17; sy = 18 + Math.random() * 108; }
      else { sx = 127; sy = 18 + Math.random() * 108; }
      if (Math.hypot(sx - G.player.x, sy - G.player.y) > 26) break;
    }

    const r = Math.random();
    let kind = 'stalker';
    if (G.wave >= 2 && r > 0.72) kind = 'shooter';
    if (G.wave >= 3 && r > 0.88) kind = 'brute';

    const specs = {
      stalker: { stack: 'enemyStalker', hp: 2 + Math.floor(G.wave / 4), speed: 15 + Math.min(8, G.wave * 0.7), rad: 2.3, scale: 0.42, pts: 100 },
      shooter: { stack: 'enemyShooter', hp: 3 + Math.floor(G.wave / 4), speed: 11.5, rad: 2.4, scale: 0.44, pts: 160, shootCd: 1.5 },
      brute:   { stack: 'enemyBrute',   hp: 8 + G.wave,                   speed: 8.5,  rad: 3.4, scale: 0.48, pts: 300 }
    }[kind];

    G.enemies.push(Object.assign({
      kind, x: sx, y: sy, rot: 0, flash: 0, bobPhase: Math.random() * 6.28
    }, specs));
  }

  function explodeAt(x, y, radius, dmg) {
    G.explosions.push({ x, y, z: 2, age: 0, maxAge: 0.45, scale: radius * 0.14 });
    G.shake = Math.min(3.5, G.shake + 1.8);
    sfx('boom');

    // Damage enemies in radius
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < radius + e.rad) {
        e.hp -= dmg;
        e.flash = 0.16;
        if (d > 0.1) {
          e.x += ((e.x - x) / d) * 4.5;
          e.y += ((e.y - y) / d) * 4.5;
        }
      }
    }
    // Chain-detonate nearby barrels
    for (let i = G.barrels.length - 1; i >= 0; i--) {
      const b = G.barrels[i];
      if (Math.hypot(b.x - x, b.y - y) < radius) {
        G.barrels.splice(i, 1);
        explodeAt(b.x, b.y, 15, 6);
      }
    }
  }

  // ---------------------------------------------------------------- Exact Screen -> World Raycast
  function unproject(ndcX, ndcY, ndcZ, inv) {
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * ndcZ + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * ndcZ + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * ndcZ + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * ndcZ + inv[15];
    return [x / w, y / w, z / w];
  }

  function screenToWorld(clientX, clientY, targetZ) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const M = Engine.cameraMatrices(cam, canvas.width / canvas.height);
    const p0 = unproject(nx, ny, -1, M.inv);
    const p1 = unproject(nx, ny, 1, M.inv);
    const dz = p1[2] - p0[2];
    const t = Math.abs(dz) > 1e-5 ? (targetZ - p0[2]) / dz : 0.5;
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
  }

  // ---------------------------------------------------------------- Input
  const keys = {};
  const mouse = { x: window.innerWidth * 0.6, y: window.innerHeight * 0.45, down: false, rotating: false, lx: 0 };

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === '1') G.player.weaponIdx = 0;
    else if (k === '2') G.player.weaponIdx = 1;
    else if (k === '3') G.player.weaponIdx = 2;
    else if (k === ' ' || k === 'shift') { e.preventDefault(); tryDash(); }
    else if (k === 'p') cam.mode = cam.mode === 'ortho' ? 'persp' : 'ortho';
    else if (k === 'd' && Dither) { G.ditherOn = !G.ditherOn; syncBadges(); }
    else if (k === 'r') { G.res = (G.res % 4) + 1; syncBadges(); }
    else if (k === 'm') { muted = !muted; syncBadges(); }
    else if (k === 'enter' && G.gameOver) resetGame();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) { mouse.rotating = true; mouse.lx = e.clientX; }
    else if (e.button === 0) mouse.down = true;
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 2) mouse.rotating = false;
    else if (e.button === 0) mouse.down = false;
  });
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (mouse.rotating) {
      cam.yaw -= (e.clientX - mouse.lx) * 0.008;
      mouse.lx = e.clientX;
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(32, Math.min(92, cam.dist + e.deltaY * 0.04));
  }, { passive: false });

  document.getElementById('btn-restart').onclick = resetGame;
  document.getElementById('btn-dither').onclick = () => { if (Dither) { G.ditherOn = !G.ditherOn; syncBadges(); } };
  document.getElementById('btn-mute').onclick = () => { muted = !muted; syncBadges(); };
  document.getElementById('btn-cam').onclick = () => { cam.mode = cam.mode === 'ortho' ? 'persp' : 'ortho'; syncBadges(); };
  [1, 2, 3].forEach((n) => {
    document.getElementById(`wpn-${n}`).onclick = () => { G.player.weaponIdx = n - 1; };
  });

  function syncBadges() {
    document.getElementById('btn-dither').textContent = G.ditherOn ? 'Dither: ON' : 'Dither: OFF';
    postCanvas.style.display = G.ditherOn ? 'block' : 'none';
    document.getElementById('btn-mute').textContent = muted ? 'Som: OFF' : 'Som: ON';
    document.getElementById('btn-cam').textContent = cam.mode === 'ortho' ? 'Câm: Orto' : 'Câm: Persp';
  }

  function tryDash() {
    const p = G.player;
    if (G.gameOver || p.dashCd > 0) return;
    let mx = 0, my = 0;
    const fwdX = Math.cos(cam.yaw), fwdY = Math.sin(cam.yaw);
    const rgtX = Math.sin(cam.yaw), rgtY = -Math.cos(cam.yaw);
    if (keys.w || keys.arrowup) { mx += fwdX; my += fwdY; }
    if (keys.s || keys.arrowdown) { mx -= fwdX; my -= fwdY; }
    if (keys.d || keys.arrowright) { mx += rgtX; my += rgtY; }
    if (keys.a || keys.arrowleft) { mx -= rgtX; my -= rgtY; }
    const len = Math.hypot(mx, my);
    if (len > 0.01) { mx /= len; my /= len; }
    else { mx = Math.cos(p.aim); my = Math.sin(p.aim); }
    p.dashVx = mx * 64;
    p.dashVy = my * 64;
    p.dashTime = 0.18;
    p.dashCd = 1.05;
    p.invuln = Math.max(p.invuln, 0.24);
    sfx('dash');
  }

  // ---------------------------------------------------------------- Main Game Step
  function updateGame(dt) {
    const p = G.player;
    if (G.gameOver) return;

    // Rotate camera with Q / E
    if (keys.q) cam.yaw += dt * 1.8;
    if (keys.e) cam.yaw -= dt * 1.8;

    // Update exact mouse world target & player aim angle
    const aimPt = screenToWorld(mouse.x, mouse.y, 2.5);
    G.aimWorld = aimPt;
    p.aim = Math.atan2(aimPt[1] - p.y, aimPt[0] - p.x);

    // Camera-relative WASD movement
    let vx = 0, vy = 0;
    const fwdX = Math.cos(cam.yaw), fwdY = Math.sin(cam.yaw);
    const rgtX = Math.sin(cam.yaw), rgtY = -Math.cos(cam.yaw);
    if (keys.w || keys.arrowup) { vx += fwdX; vy += fwdY; }
    if (keys.s || keys.arrowdown) { vx -= fwdX; vy -= fwdY; }
    if (keys.d || keys.arrowright) { vx += rgtX; vy += rgtY; }
    if (keys.a || keys.arrowleft) { vx -= rgtX; vy -= rgtY; }

    if (p.dashTime > 0) {
      p.dashTime -= dt;
      vx = p.dashVx; vy = p.dashVy;
    } else {
      const mlen = Math.hypot(vx, vy);
      if (mlen > 0.01) {
        const speed = 23 + (p.overdrive > 0 ? 5 : 0);
        vx = (vx / mlen) * speed;
        vy = (vy / mlen) * speed;
        p.moveYaw = Math.atan2(vy, vx);
      } else {
        vx = 0; vy = 0;
        p.moveYaw = p.aim;
      }
    }

    const [nx, ny] = resolveCircleObstacles(p.x + vx * dt, p.y + vy * dt, 2.2);
    p.x = nx; p.y = ny;
    Rig.step(p.walker, p.x / PLAYER_SCALE, p.y / PLAYER_SCALE, p.moveYaw, dt);

    // Cooldowns
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.overdrive = Math.max(0, p.overdrive - dt);
    p.recoil = Math.max(0, p.recoil - dt * 6);
    p.muzzleFlash = Math.max(0, p.muzzleFlash - dt * 10);
    G.shake = Math.max(0, G.shake - dt * 8);
    if (G.comboTimer > 0) {
      G.comboTimer -= dt;
      if (G.comboTimer <= 0) G.combo = 0;
    }

    // Shooting
    const wpn = WEAPONS[p.weaponIdx];
    const fireRate = p.overdrive > 0 ? wpn.cd * 0.52 : wpn.cd;
    if (mouse.down && p.fireCd <= 0) {
      p.fireCd = fireRate;
      p.recoil = 1.0;
      p.muzzleFlash = 1.0;
      G.shake = Math.min(2.0, G.shake + (wpn.id === 1 ? 0.28 : 0.75));
      sfx(wpn.sfx);

      const muzzleX = p.x + Math.cos(p.aim) * 2.8;
      const muzzleY = p.y + Math.sin(p.aim) * 2.8;
      for (let i = 0; i < wpn.count; i++) {
        const ang = p.aim + (Math.random() - 0.5) * wpn.spread;
        G.bullets.push({
          from: 'player',
          stack: wpn.stack,
          x: muzzleX, y: muzzleY, z: 3.6,
          vx: Math.cos(ang) * wpn.speed,
          vy: Math.sin(ang) * wpn.speed,
          rot: ang,
          dmg: wpn.dmg,
          splash: wpn.splash || 0,
          life: 1.4
        });
      }
    }

    // Wave spawning
    if (G.toSpawn > 0) {
      G.spawnCd -= dt;
      if (G.spawnCd <= 0) {
        spawnEnemy();
        G.toSpawn--;
        G.spawnCd = Math.max(0.28, 1.0 - G.wave * 0.08);
      }
    } else if (G.enemies.length === 0) {
      G.waveTimer += dt;
      if (G.waveTimer > 1.4) {
        G.waveTimer = 0;
        startWave(G.wave + 1);
      }
    }

    // Bullets update & collisions
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || hitsObstacle(b.x, b.y, 0.5)) {
        if (b.splash) explodeAt(b.x, b.y, b.splash, b.dmg);
        G.bullets.splice(i, 1);
        continue;
      }

      if (b.from === 'player') {
        let hit = false;
        // Check barrels
        for (let bi = G.barrels.length - 1; bi >= 0; bi--) {
          const bar = G.barrels[bi];
          if (Math.hypot(b.x - bar.x, b.y - bar.y) < 3.4) {
            bar.hp -= b.dmg;
            bar.flash = 0.12;
            hit = true;
            if (bar.hp <= 0) {
              G.barrels.splice(bi, 1);
              explodeAt(bar.x, bar.y, 16, 6);
            }
            break;
          }
        }
        if (hit) { G.bullets.splice(i, 1); continue; }

        // Check enemies
        for (let ei = G.enemies.length - 1; ei >= 0; ei--) {
          const e = G.enemies[ei];
          if (Math.hypot(b.x - e.x, b.y - e.y) < e.rad + 0.8) {
            e.hp -= b.dmg;
            e.flash = 0.12;
            e.x += (b.vx / 80) * 1.2;
            e.y += (b.vy / 80) * 1.2;
            sfx('hit');
            if (b.splash) explodeAt(b.x, b.y, b.splash, b.dmg);
            hit = true;
            break;
          }
        }
        if (hit) G.bullets.splice(i, 1);
      } else {
        // Enemy bullet hitting player
        if (p.invuln <= 0 && Math.hypot(b.x - p.x, b.y - p.y) < 2.2) {
          p.hp = Math.max(0, p.hp - 14);
          p.invuln = 0.45;
          G.shake = 2.0;
          sfx('hurt');
          G.bullets.splice(i, 1);
          if (p.hp <= 0) {
            G.gameOver = true;
            document.getElementById('gameover').classList.add('show');
            document.getElementById('final-score').textContent = `Pontos: ${G.score} · Onda ${G.wave}`;
          }
        }
      }
    }

    // Enemies AI & removal
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.hp <= 0) {
        G.combo++;
        G.comboTimer = 3.0;
        G.score += e.pts * Math.min(5, 1 + Math.floor(G.combo / 4));
        G.explosions.push({ x: e.x, y: e.y, z: 2, age: 0, maxAge: 0.28, scale: 0.7 });
        // Drop chance
        const dropR = Math.random();
        if (dropR < 0.14) G.pickups.push({ kind: 'pickupHp', x: e.x, y: e.y, age: 0 });
        else if (dropR < 0.22) G.pickups.push({ kind: 'pickupOver', x: e.x, y: e.y, age: 0 });
        G.enemies.splice(i, 1);
        continue;
      }

      e.flash = Math.max(0, e.flash - dt);
      e.bobPhase += dt * 7;
      const dx = p.x - e.x, dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      e.rot = Math.atan2(dy, dx);

      let moveDir = 1;
      if (e.kind === 'shooter') {
        if (dist < 24) moveDir = -0.6;
        else if (dist < 34) moveDir = 0;
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 56) {
          e.shootCd = 2.0 - Math.min(0.8, G.wave * 0.08);
          G.bullets.push({
            from: 'enemy', stack: 'projEnemy',
            x: e.x, y: e.y, z: 4.5,
            vx: (dx / dist) * 34, vy: (dy / dist) * 34,
            rot: e.rot, dmg: 1, life: 2.2
          });
        }
      }

      // Soft separation between enemies so they don't stack into one spot
      let sepX = 0, sepY = 0;
      for (let j = 0; j < G.enemies.length; j++) {
        if (i === j) continue;
        const o = G.enemies[j];
        const sx = e.x - o.x, sy = e.y - o.y;
        const sd = Math.hypot(sx, sy);
        const minD = e.rad + o.rad;
        if (sd > 0.01 && sd < minD) {
          sepX += (sx / sd) * (minD - sd) * 6;
          sepY += (sy / sd) * (minD - sd) * 6;
        }
      }

      const ex = e.x + ((dx / dist) * e.speed * moveDir + sepX) * dt;
      const ey = e.y + ((dy / dist) * e.speed * moveDir + sepY) * dt;
      const [rx, ry] = resolveCircleObstacles(ex, ey, e.rad);
      e.x = rx; e.y = ry;

      if (p.invuln <= 0 && dist < e.rad + 2.0) {
        p.hp = Math.max(0, p.hp - (e.kind === 'brute' ? 22 : 14));
        p.invuln = 0.55;
        G.shake = 2.2;
        sfx('hurt');
        if (p.hp <= 0) {
          G.gameOver = true;
          document.getElementById('gameover').classList.add('show');
          document.getElementById('final-score').textContent = `Pontos: ${G.score} · Onda ${G.wave}`;
        }
      }
    }

    // Pickups
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const pk = G.pickups[i];
      pk.age += dt;
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < 3.6) {
        if (pk.kind === 'pickupHp') p.hp = Math.min(p.maxHp, p.hp + 25);
        else p.overdrive = 7.0;
        sfx('pickup');
        G.pickups.splice(i, 1);
      } else if (pk.age > 14) {
        G.pickups.splice(i, 1);
      }
    }

    // Explosions
    for (let i = G.explosions.length - 1; i >= 0; i--) {
      G.explosions[i].age += dt;
      if (G.explosions[i].age >= G.explosions[i].maxAge) G.explosions.splice(i, 1);
    }

    // Smooth camera follow with slight lead toward cursor
    const leadX = Math.max(-9, Math.min(9, (aimPt[0] - p.x) * 0.22));
    const leadY = Math.max(-9, Math.min(9, (aimPt[1] - p.y) * 0.22));
    const k = 1 - Math.exp(-dt * 8);
    cam.tx += (p.x + leadX - cam.tx) * k + (Math.random() - 0.5) * G.shake * 0.35;
    cam.ty += (p.y + leadY - cam.ty) * k + (Math.random() - 0.5) * G.shake * 0.35;
  }

  // ---------------------------------------------------------------- Render Loop
  resetGame();
  syncBadges();

  const hud = {
    hpBar: document.getElementById('hp-fill'),
    hpTxt: document.getElementById('hp-txt'),
    score: document.getElementById('hud-score'),
    wave: document.getElementById('hud-wave'),
    combo: document.getElementById('hud-combo'),
    overdrive: document.getElementById('hud-over'),
    dashBar: document.getElementById('dash-fill'),
    wpns: [document.getElementById('wpn-1'), document.getElementById('wpn-2'), document.getElementById('wpn-3')]
  };

  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(300, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(300, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
    }

    updateGame(dt);

    // Assemble frame render list
    const list = staticList.slice();
    const blobs = [];
    const lamps = [
      [72, 32, 18, 34, 0.30, 0.85, 1.0],
      [72, 112, 18, 34, 0.30, 0.85, 1.0],
      [32, 72, 18, 34, 0.30, 0.85, 1.0],
      [112, 72, 18, 34, 0.30, 0.85, 1.0]
    ];

    const p = G.player;
    // Blink briefly on damage
    if (p.invuln <= 0 || Math.floor(now / 60) % 2 === 0) {
      const pose = Rig.pose(p.walker);
      const R = Engine.figureWriter(list, PLAYER_SCALE, 1);
      ArenaScene.drawPlayer(R, playerArt, pose, p.aim, p.recoil);
    }
    blobs.push([p.x, p.y, 4, 2.8, 1]);

    if (p.muzzleFlash > 0.1) {
      lamps.push([p.x + Math.cos(p.aim) * 4, p.y + Math.sin(p.aim) * 4, 4.5, 22 * p.muzzleFlash, 0.45, 0.95, 1.0]);
    }

    // Aim target ring on floor
    list.push({ stack: S.aimRing, x: G.aimWorld[0], y: G.aimWorld[1], z: 1.05, rot: now * 0.002, scale: 0.7 });

    // Barrels
    G.barrels.forEach((b) => {
      list.push({ stack: S.barrel, x: b.x, y: b.y, z: 1, rot: 0, scale: 0.95 });
      blobs.push([b.x, b.y, 5, 2.8, 1]);
    });

    // Pickups
    G.pickups.forEach((pk) => {
      list.push({ stack: S[pk.kind], x: pk.x, y: pk.y, z: 1.5 + Math.sin(pk.age * 4) * 0.8, rot: pk.age * 2.2, scale: 0.75 });
    });

    // Enemies
    G.enemies.forEach((e) => {
      const hop = e.kind === 'shooter' ? Math.sin(e.bobPhase) * 0.9 : Math.abs(Math.sin(e.bobPhase)) * 0.8;
      list.push({ stack: S[e.stack], x: e.x, y: e.y, z: 1 + hop, rot: e.rot, scale: e.scale });
      blobs.push([e.x, e.y, 5, e.rad * 1.1, 1]);
    });

    // Bullets + dynamic projectile lights
    G.bullets.forEach((b) => {
      list.push({ stack: S[b.stack], x: b.x, y: b.y, z: b.z, rot: b.rot, scale: 0.65 });
      if (lamps.length < 8) {
        if (b.from === 'player') lamps.push([b.x, b.y, b.z, 12, 0.45, 0.9, 1.0]);
        else lamps.push([b.x, b.y, b.z, 12, 1.0, 0.25, 0.35]);
      }
    });

    // Explosions
    G.explosions.forEach((ex) => {
      const t = ex.age / ex.maxAge;
      const sc = ex.scale * (0.6 + Math.sin(t * Math.PI) * 1.1);
      list.push({ stack: S.fxExplosion, x: ex.x, y: ex.y, z: ex.z, rot: t * 2.5, scale: sc });
      if (lamps.length < 8) lamps.push([ex.x, ex.y, 6, 36 * (1 - t), 1.0, 0.58, 0.18]);
    });

    E.render({
      cam,
      list,
      atlas: atlasTex,
      hsr: true,
      fill: true,
      guard: true,
      voxel: true,
      lod: false,
      heat: 0,
      measure: false,
      scale: G.res,
      shadows: true,
      ao: true,
      bloom: true,
      water: -9,
      ground: 1,
      time: now * 0.001,
      light: ArenaScene.light(G.tod),
      lamps,
      blobs
    });

    if (G.ditherOn && Dither) {
      Dither.apply(E.stats.iw, E.stats.ih, { dither: G.dither, levels: 8, palette: 'Níveis (Posterize)' });
    }

    // Update HUD
    hud.hpBar.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    hud.hpTxt.textContent = `${p.hp}/${p.maxHp}`;
    hud.score.textContent = G.score.toLocaleString('pt-BR');
    hud.wave.textContent = `ONDA ${G.wave}`;
    hud.combo.textContent = G.combo > 1 ? `COMBO ×${Math.min(5, 1 + Math.floor(G.combo / 4))}` : '';
    hud.overdrive.style.display = p.overdrive > 0 ? 'inline-block' : 'none';
    hud.dashBar.style.width = `${Math.max(0, Math.min(1, 1 - p.dashCd / 1.05)) * 100}%`;
    hud.wpns.forEach((el, i) => el.classList.toggle('active', i === p.weaponIdx));

    requestAnimationFrame(tick);
  }

  document.body.classList.add('ready');
  requestAnimationFrame(tick);
})();
