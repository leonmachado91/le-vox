// main.js: TURBO-86 Garage diorama runner using loktar00/sprite-stack-engine.
(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const postCanvas = document.getElementById('post');
  const statsEl = document.getElementById('stats');
  const badge = document.getElementById('badge');
  const E = Engine.create(canvas);
  const Dither = PostDither.create(canvas, postCanvas);
  const WORLD = CarScene.WORLD;

  // Build both whole (shell=0) and surface-only (shell=3) atlases
  const pal = CarScene.palette();
  const DEFS = CarScene.stacks();
  const SETS = [0, 3].map((shell) => {
    const atlas = new Art.Atlas(2048);
    const stacks = {};
    DEFS.forEach((d) => { stacks[d.name] = Art.buildStack(d, pal, atlas, shell); });
    return { stacks, atlas: E.makeAtlas(atlas.data, atlas.size), pixels: atlas.used };
  });
  E.setPalette(pal.bytes());

  const LAYOUT = CarScene.layout();
  const statics = SETS.map((S) => LAYOUT.map((l) => ({
    stack: S.stacks[l.n], x: l.x, y: l.y, z: l.z, rot: l.rot || 0, scale: l.scale || 1,
    only: -1, sway: l.sway || 0, shx: 0, shy: 0, tag: l.tag || ''
  })));

  // Stamp static objects into the real shadow/occlusion height map
  const hm = new Uint8Array(WORLD.w * WORLD.h);
  hm.fill(2); // z=1 base
  statics[0].forEach((it) => {
    const st = it.stack, d = st.def;
    if (d.ground || d.noShadow) return;
    const c = Math.cos(it.rot), s = Math.sin(it.rot);
    for (let y = 0; y < st.h; y++) {
      for (let x = 0; x < st.w; x++) {
        const lx = x + 0.5 - st.w / 2, ly = y + 0.5 - st.h / 2;
        let z = st.n - 1;
        while (z >= 0 && !(st.vox[(z * st.h + y) * st.w + x] && (!d.shadowIf || d.shadowIf(lx, ly, z)))) z--;
        if (z < 0) continue;
        const wx = it.x + (lx * c - ly * s) * it.scale;
        const wy = it.y + (lx * s + ly * c) * it.scale;
        const v = Math.min(255, Math.round((it.z + (z + 1) * it.scale) * 2));
        for (let k = 0; k < 4; k++) {
          const cx = Math.floor(wx + (k & 1) * 0.6 - 0.3);
          const cy = Math.floor(wy + (k >> 1) * 0.6 - 0.3);
          if (cx > 0 && cy > 0 && cx < WORLD.w - 1 && cy < WORLD.h - 1) {
            if (v > hm[cy * WORLD.w + cx]) hm[cy * WORLD.w + cx] = v;
          }
        }
      }
    }
  });
  E.setHeightMap(hm, WORLD.w, WORLD.h);

  // State & camera
  const cam = { mode: 'persp', tx: 71, ty: 68, tz: 5, yaw: 0.78, pitch: 0.44, dist: 58, fov: 38 * Math.PI / 180 };
  const S = {
    res: 3,         // internal scale = 3x (crisp pixel art & fast even without dedicated GPU)
    voxel: 1,       // -1 auto, 1 always, 0 off
    shell: true,
    hsr: true,
    fill: true,
    guard: true,
    shadows: true,
    ao: true,
    bloom: true,
    tod: 0.60,      // sunset / golden hour
    orbit: true,
    carBuild: 1.0,  // 0..1 slice printer progress
    dismantle: 0.0, // 0..1 explode slices
    garageCut: false,
    ditherOn: !!Dither,
    dither: 0.65,
    levels: 8,
    palette: 'Níveis (Posterize)'
  };

  // UI Sync
  const ui = {
    tod: document.getElementById('ctrl-tod'),
    res: document.getElementById('ctrl-res'),
    pal: document.getElementById('ctrl-pal'),
    dither: document.getElementById('ctrl-dither'),
    levels: document.getElementById('ctrl-levels'),
    lblDither: document.getElementById('lbl-dither'),
    lblLevels: document.getElementById('lbl-levels'),
    build: document.getElementById('ctrl-build'),
    dismantle: document.getElementById('ctrl-dismantle'),
    btnDither: document.getElementById('btn-dither'),
    voxel: document.getElementById('btn-voxel'),
    cam: document.getElementById('btn-cam'),
    orbit: document.getElementById('btn-orbit'),
    cut: document.getElementById('btn-cut'),
    shadows: document.getElementById('btn-shadows'),
    ao: document.getElementById('btn-ao'),
    printAnim: document.getElementById('btn-print'),
    exportCfg: document.getElementById('btn-export'),
  };

  if (Dither) {
    Dither.palettes.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      ui.pal.appendChild(opt);
    });
    ui.pal.value = S.palette;
  }

  let printing = false;
  ui.tod.value = S.tod;
  ui.res.value = S.res;
  ui.dither.value = S.dither;
  ui.levels.value = S.levels;
  ui.build.value = S.carBuild;
  ui.dismantle.value = S.dismantle;

  ui.tod.addEventListener('input', () => { S.tod = parseFloat(ui.tod.value); });
  ui.res.addEventListener('input', () => { S.res = parseInt(ui.res.value, 10); });
  ui.pal.addEventListener('change', () => { S.palette = ui.pal.value; });
  ui.dither.addEventListener('input', () => { S.dither = parseFloat(ui.dither.value); ui.lblDither.textContent = S.dither.toFixed(2); });
  ui.levels.addEventListener('input', () => { S.levels = parseInt(ui.levels.value, 10); ui.lblLevels.textContent = String(S.levels); });
  ui.build.addEventListener('input', () => { printing = false; S.carBuild = parseFloat(ui.build.value); });
  ui.dismantle.addEventListener('input', () => { S.dismantle = parseFloat(ui.dismantle.value); });

  function syncButtons() {
    ui.btnDither.textContent = S.ditherOn ? 'Dither: ON' : 'Dither: OFF';
    postCanvas.style.display = S.ditherOn ? 'block' : 'none';
    ui.voxel.textContent = S.voxel === 1 ? 'Voxel: ON' : S.voxel === 0 ? 'Voxel: OFF' : 'Voxel: AUTO';
    ui.cam.textContent = cam.mode === 'persp' ? 'Câmera: Persp' : 'Câmera: Orto';
    ui.orbit.textContent = S.orbit ? 'Girar: ON' : 'Girar: OFF';
    ui.cut.textContent = S.garageCut ? 'Garagem: Aberta' : 'Garagem: Fechada';
    ui.shadows.textContent = S.shadows ? 'Sombras: ON' : 'Sombras: OFF';
    ui.ao.textContent = S.ao ? 'AO: ON' : 'AO: OFF';
  }
  syncButtons();

  ui.btnDither.onclick = () => { if (Dither) { S.ditherOn = !S.ditherOn; syncButtons(); } };
  ui.voxel.onclick = () => { S.voxel = S.voxel === 1 ? -1 : S.voxel === -1 ? 0 : 1; syncButtons(); };
  ui.cam.onclick = () => { cam.mode = cam.mode === 'persp' ? 'ortho' : 'persp'; syncButtons(); };
  ui.orbit.onclick = () => { S.orbit = !S.orbit; syncButtons(); };
  ui.cut.onclick = () => { S.garageCut = !S.garageCut; syncButtons(); };
  ui.shadows.onclick = () => { S.shadows = !S.shadows; syncButtons(); };
  ui.ao.onclick = () => { S.ao = !S.ao; syncButtons(); };
  ui.printAnim.onclick = () => {
    S.carBuild = 0;
    S.dismantle = 0;
    ui.dismantle.value = 0;
    printing = true;
  };
  ui.exportCfg.onclick = () => {
    const cfg = JSON.stringify({ state: S, cam }, null, 2);
    navigator.clipboard?.writeText(cfg);
    ui.exportCfg.textContent = 'Copiado!';
    setTimeout(() => { ui.exportCfg.textContent = 'Copiar Config'; }, 1600);
  };

  // Pointer controls
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = cam.dist * 0.0014;
      const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      cam.tx -= (dx * sy - dy * cy) * k;
      cam.ty += (dx * cy + dy * sy) * k;
    } else {
      cam.yaw -= dx * 0.007;
      cam.pitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.01, cam.pitch + dy * 0.006));
    }
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(20, Math.min(180, cam.dist + e.deltaY * 0.05));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'd') ui.btnDither.click();
    else if (k === 'v') ui.voxel.click();
    else if (k === 'p') ui.cam.click();
    else if (k === ' ') { e.preventDefault(); ui.orbit.click(); }
    else if (k === 'c') ui.cut.click();
    else if (k === 's') ui.shadows.click();
    else if (k === 'a') ui.ao.click();
    else if (k === 'b') S.bloom = !S.bloom;
    else if (k === 'r') { S.res = (S.res % 5) + 1; ui.res.value = S.res; }
    else if (k === 'z') ui.printAnim.click();
    else if (k === 'x') { S.dismantle = S.dismantle > 0.1 ? 0 : 0.75; ui.dismantle.value = S.dismantle; }
    else if (k === 'n') { S.tod = S.tod > 0.9 ? 0.05 : S.tod > 0.5 ? 1.0 : 0.6; ui.tod.value = S.tod; }
  });

  // Dynamic per-slice modifier for the car (3D printer build + dismantle) and garage cutaway
  const moved = { dx: 0, dy: 0, dz: 0, rot: 0, scale: 1 };
  function applySliceFX(list) {
    for (const it of list) {
      if (it.tag === 'car') {
        if (S.carBuild < 0.999 || S.dismantle > 0.001) {
          it.each = (z, n, out) => {
            const cut = S.carBuild * n;
            if (z > cut) return null;
            out.dx = 0; out.dy = 0; out.dz = 0; out.rot = 0; out.scale = 1;
            if (S.carBuild < 0.999 && z > cut - 1.5) {
              const frac = Math.max(0, 1 - (cut - z) / 1.5);
              out.dz = frac * 6.0;
              out.rot = frac * 0.2;
            }
            if (S.dismantle > 0.001 && z >= 10) {
              out.dz += (z - 9) * S.dismantle * 1.45;
            }
            return out;
          };
        } else {
          it.each = null;
        }
      } else if (it.tag === 'garage') {
        it.each = S.garageCut ? (z, n, out) => {
          if (z > 13) return null;
          out.dx = 0; out.dy = 0; out.dz = 0; out.rot = 0; out.scale = 1;
          return out;
        } : null;
      }
    }
  }

  const VOXEL_TILT = 18 * Math.PI / 180;
  let lastT = performance.now();

  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const tSec = now * 0.001;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(300, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(300, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    if (S.orbit && !drag) cam.yaw += dt * 0.25;
    if (printing) {
      S.carBuild = Math.min(1.0, S.carBuild + dt * 0.45);
      ui.build.value = S.carBuild;
      if (S.carBuild >= 1.0) printing = false;
    }

    const setIdx = S.shell ? 1 : 0;
    const list = statics[setIdx];
    applySliceFX(list);

    // Subtle wind sway on trees
    for (const it of list) {
      if (it.sway) {
        it.shx = Math.sin(tSec * 1.7 + it.x) * it.sway;
        it.shy = Math.cos(tSec * 1.3 + it.y) * it.sway * 0.7;
      }
    }

    const useVoxel = S.voxel === 1 || (S.voxel < 0 && cam.pitch < VOXEL_TILT);
    badge.classList.toggle('on', useVoxel);

    const env = CarScene.light(S.tod);
    const car = list.find((it) => it.tag === 'car');
    const cCos = Math.cos(car.rot), cSin = Math.sin(car.rot);
    // World-space positions for headlights (+x) and taillights (-x)
    const lamps = [
      [34, 51, 32, 48, 1.0, 0.86, 0.56],                                       // streetlamp
      [car.x + cCos * 21 - cSin * 5, car.y + cSin * 21 + cCos * 5, 5, 26, 1.0, 0.94, 0.70],
      [car.x + cCos * 21 + cSin * 5, car.y + cSin * 21 - cCos * 5, 5, 26, 1.0, 0.94, 0.70],
      [car.x - cCos * 21 - cSin * 5, car.y - cSin * 21 + cCos * 5, 6, 16, 1.0, 0.20, 0.16],
      [car.x - cCos * 21 + cSin * 5, car.y - cSin * 21 - cCos * 5, 6, 16, 1.0, 0.20, 0.16],
      [66, 8, 25, 34, 0.35, 0.90, 1.0]                                         // TURBO neon sign glow
    ];

    E.render({
      cam,
      list,
      atlas: SETS[setIdx].atlas,
      hsr: S.hsr,
      fill: S.fill,
      guard: S.guard,
      voxel: useVoxel,
      lod: false,
      heat: 0,
      measure: false,
      scale: S.res,
      shadows: S.shadows,
      ao: S.ao,
      bloom: S.bloom,
      water: -9,
      ground: 1,
      time: tSec,
      light: env,
      lamps,
      blobs: [[car.x, car.y, 6, 15, 0.5]]
    });

    if (S.ditherOn && Dither) {
      Dither.apply(E.stats.iw, E.stats.ih, {
        dither: S.dither,
        levels: S.levels,
        palette: S.palette
      });
    }

    statsEl.textContent =
      `modo: ${useVoxel ? 'VOXEL (caixas 3D)' : 'SLICES (2D empilhado)'}${S.ditherOn ? ' + BAYER' : ''}\n` +
      `interno: ${E.stats.iw}×${E.stats.ih}px (escala ${S.res}×) · cpu ${E.stats.cpuMs.toFixed(1)}ms\n` +
      `instâncias: ${E.stats.instances} · fatias: ${E.stats.slices}`;

    requestAnimationFrame(tick);
  }

  document.body.classList.add('ready');
  requestAnimationFrame(tick);
})();
