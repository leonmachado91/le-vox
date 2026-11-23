// main.js: Oceanic 815 mid-air breakup ("Lost" bullet-time diorama)
(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const postCanvas = document.getElementById('post');
  const statsEl = document.getElementById('stats');
  const badge = document.getElementById('badge');
  const timeBadge = document.getElementById('time-badge');
  const E = Engine.create(canvas);
  const Dither = PostDither.create(canvas, postCanvas);
  const WORLD = LostScene.WORLD;

  const pal = LostScene.palette();
  const DEFS = LostScene.stacks();
  const SETS = [0, 3].map((shell) => {
    const atlas = new Art.Atlas(2048);
    const stacks = {};
    DEFS.forEach((d) => { stacks[d.name] = Art.buildStack(d, pal, atlas, shell); });
    return { stacks, atlas: E.makeAtlas(atlas.data, atlas.size), pixels: atlas.used };
  });
  E.setPalette(pal.bytes());

  const LAYOUT = LostScene.layout();
  const statics = SETS.map((S) => LAYOUT.map((l) => Object.assign({}, l, {
    stack: S.stacks[l.n], only: -1, shx: 0, shy: 0
  })));

  // Build ground height map (palms & rocks cast static shadows; plane hovers above via blobs)
  const hm = new Uint8Array(WORLD.w * WORLD.h);
  hm.fill(1);
  statics[0].forEach((it) => {
    const st = it.stack, d = st.def;
    if (d.noShadow) return;
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

  // Camera & presets
  const PRESETS = {
    1: { tx: 66, ty: 72, tz: 24, yaw: 0.72, pitch: 0.42, dist: 86 },  // Geral
    2: { tx: 64, ty: 72, tz: 29, yaw: 1.15, pitch: 0.22, dist: 38 },  // Dentro do rasgo (close)
    3: { tx: 78, ty: 68, tz: 25, yaw: -0.35, pitch: 0.28, dist: 42 }, // Turbina em chamas
    4: { tx: 65, ty: 72, tz: 24, yaw: 2.35, pitch: 0.08, dist: 68 }   // Praia olhando p/ cima
  };
  const cam = Object.assign({ mode: 'persp', fov: 40 * Math.PI / 180 }, PRESETS[1]);
  let camTarget = null;

  const S = {
    res: 3,
    voxel: 1,
    shell: true,
    shadows: true,
    ao: true,
    bloom: true,
    tod: 0.56,        // dramatic sunset storm
    orbit: true,
    timeScale: 0.12,  // slow-mo bullet time by default (0 = frozen!)
    simTime: 0.0,
    breakup: 0.0,     // 0..1 crash progression
    xray: false,
    build: 1.0,
    ditherOn: !!Dither,
    dither: 0.55,
    levels: 9,
    palette: 'Níveis (Posterize)'
  };

  let fallAnimating = false;
  let printing = false;
  let flash = 0.0;

  // UI refs
  const ui = {
    timeScale: document.getElementById('ctrl-time'),
    lblTime: document.getElementById('lbl-time'),
    breakup: document.getElementById('ctrl-breakup'),
    lblBreakup: document.getElementById('lbl-breakup'),
    tod: document.getElementById('ctrl-tod'),
    res: document.getElementById('ctrl-res'),
    pal: document.getElementById('ctrl-pal'),
    dither: document.getElementById('ctrl-dither'),
    lblDither: document.getElementById('lbl-dither'),
    btnFreeze: document.getElementById('btn-freeze'),
    btnFall: document.getElementById('btn-fall'),
    btnXray: document.getElementById('btn-xray'),
    btnLightning: document.getElementById('btn-lightning'),
    btnPrint: document.getElementById('btn-print'),
    btnOrbit: document.getElementById('btn-orbit'),
    btnVoxel: document.getElementById('btn-voxel'),
    btnDither: document.getElementById('btn-dither'),
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

  function syncUI() {
    ui.lblTime.textContent = S.timeScale === 0 ? 'CONGELADO' : `${S.timeScale.toFixed(2)}×`;
    ui.lblBreakup.textContent = `${Math.round(S.breakup * 100)}%`;
    ui.lblDither.textContent = S.dither.toFixed(2);
    ui.btnFreeze.textContent = S.timeScale === 0 ? 'Descongelar (Espaço)' : 'Congelar Tempo';
    ui.btnXray.textContent = S.xray ? 'Raio-X: ON (K)' : 'Raio-X Cabine (K)';
    ui.btnOrbit.textContent = S.orbit ? 'Girar Câm: ON' : 'Girar Câm: OFF';
    ui.btnVoxel.textContent = S.voxel === 1 ? 'Voxel: ON' : S.voxel === 0 ? 'Voxel: OFF' : 'Voxel: AUTO';
    ui.btnDither.textContent = S.ditherOn ? 'Dither: ON' : 'Dither: OFF';
    postCanvas.style.display = S.ditherOn ? 'block' : 'none';
    timeBadge.textContent = S.timeScale === 0 ? 'TEMPO CONGELADO · BULLET TIME' :
      S.timeScale < 0 ? `REBOBINANDO (${S.timeScale.toFixed(2)}×)` :
      S.timeScale < 0.4 ? `BULLET TIME (${S.timeScale.toFixed(2)}×)` : `TEMPO (${S.timeScale.toFixed(2)}×)`;
  }
  syncUI();

  ui.timeScale.addEventListener('input', () => { S.timeScale = parseFloat(ui.timeScale.value); syncUI(); });
  ui.breakup.addEventListener('input', () => { fallAnimating = false; S.breakup = parseFloat(ui.breakup.value); syncUI(); });
  ui.tod.addEventListener('input', () => { S.tod = parseFloat(ui.tod.value); });
  ui.res.addEventListener('input', () => { S.res = parseInt(ui.res.value, 10); });
  ui.pal.addEventListener('change', () => { S.palette = ui.pal.value; });
  ui.dither.addEventListener('input', () => { S.dither = parseFloat(ui.dither.value); syncUI(); });

  let savedTimeScale = 0.15;
  ui.btnFreeze.onclick = () => {
    if (S.timeScale !== 0) { savedTimeScale = S.timeScale; S.timeScale = 0; }
    else { S.timeScale = savedTimeScale || 0.15; }
    ui.timeScale.value = S.timeScale;
    syncUI();
  };
  ui.btnFall.onclick = () => {
    if (S.breakup > 0.9) S.breakup = 0;
    fallAnimating = !fallAnimating;
  };
  ui.btnXray.onclick = () => { S.xray = !S.xray; syncUI(); };
  ui.btnLightning.onclick = () => { flash = 1.0; };
  ui.btnPrint.onclick = () => { S.build = 0; printing = true; };
  ui.btnOrbit.onclick = () => { S.orbit = !S.orbit; syncUI(); };
  ui.btnVoxel.onclick = () => { S.voxel = S.voxel === 1 ? -1 : S.voxel === -1 ? 0 : 1; syncUI(); };
  ui.btnDither.onclick = () => { if (Dither) { S.ditherOn = !S.ditherOn; syncUI(); } };

  [1, 2, 3, 4].forEach((id) => {
    document.getElementById(`cam-${id}`).onclick = () => {
      camTarget = Object.assign({}, PRESETS[id]);
    };
  });

  // Pointer controls
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    camTarget = null;
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
      cam.pitch = Math.max(-0.08, Math.min(Math.PI / 2 - 0.02, cam.pitch + dy * 0.006));
    }
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    camTarget = null;
    e.preventDefault();
    cam.dist = Math.max(18, Math.min(180, cam.dist + e.deltaY * 0.05));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); ui.btnFreeze.click(); }
    else if (k === 'e') ui.btnFall.click();
    else if (k === 'k') ui.btnXray.click();
    else if (k === 'l') ui.btnLightning.click();
    else if (k === 'z') ui.btnPrint.click();
    else if (k === 'd') ui.btnDither.click();
    else if (k === 'v') ui.btnVoxel.click();
    else if (k === 'r') { S.res = (S.res % 5) + 1; ui.res.value = S.res; }
    else if (k === '1' || k === '2' || k === '3' || k === '4') camTarget = Object.assign({}, PRESETS[Number(k)]);
  });

  function updateSimulation(list, t) {
    const b = S.breakup;
    const dropZ = b * 17.0;

    for (const it of list) {
      if (it.sway) {
        it.shx = Math.sin(t * 2.2 + it.x) * it.sway;
        it.shy = Math.cos(t * 1.6 + it.y) * it.sway * 0.8;
      }

      if (it.tag === 'front' || it.tag === 'wingR' || it.tag === 'wingL') {
        const hover = Math.sin(t * 1.4) * 0.45;
        it.x = it.baseX + b * 10.0;
        it.y = it.baseY - b * 5.0;
        it.z = Math.max(4, it.baseZ - dropZ + hover);
        it.rot = it.baseRot - b * 0.25 + Math.sin(t * 0.8) * 0.025;
      } else if (it.tag === 'tail') {
        const hover = Math.cos(t * 1.2) * 0.55;
        it.x = it.baseX - b * 14.0;
        it.y = it.baseY + b * 9.0;
        it.z = Math.max(5, it.baseZ - dropZ * 0.65 + hover);
        it.rot = it.baseRot + b * 0.48 + Math.cos(t * 0.7) * 0.03;
      } else if (it.tag === 'debris') {
        const spin = t * (0.4 + (it.idx % 3) * 0.25);
        it.x = it.baseX + it.vx * (b * 12.0 + Math.sin(t * 0.6 + it.idx) * 1.1);
        it.y = it.baseY + it.vy * (b * 12.0 + Math.cos(t * 0.5 + it.idx) * 1.1);
        it.z = Math.max(2, it.baseZ - dropZ * 0.8 + it.vz * (b * 7.0) + Math.sin(t * 1.5 + it.idx) * 0.7);
        it.rot = it.baseRot + spin + b * 2.5;
      } else if (it.tag === 'fire') {
        const pulse = 0.88 + Math.sin(t * 14.0 + it.idx * 2.0) * 0.16;
        it.x = it.baseX + b * 7.0 + Math.sin(t * 9.0 + it.idx) * 0.4;
        it.y = it.baseY - b * 3.5 + Math.cos(t * 8.0 + it.idx) * 0.4;
        it.z = Math.max(4, it.baseZ - dropZ * 0.9);
        it.scale = it.baseScale * pulse;
        it.rot = t * 1.8 + it.idx;
      } else if (it.tag === 'smoke') {
        const drift = (t * 2.4 + it.idx * 0.9) % 12.0;
        it.x = it.baseX - drift * 0.55 + Math.sin(t * 1.3 + it.idx) * 0.9;
        it.y = it.baseY + drift * 0.65;
        it.z = Math.max(6, it.baseZ - dropZ * 0.5 + drift * 0.85);
        it.scale = it.baseScale * (0.85 + drift * 0.045);
        it.rot = it.idx + t * 0.25;
      }

      // Slice effects: Build printer (Z) & X-ray cutaway (K)
      const isPlanePart = it.tag === 'front' || it.tag === 'tail' || it.tag === 'wingR' || it.tag === 'wingL';
      if (isPlanePart && (S.xray || S.build < 0.999)) {
        it.each = (z, n, out) => {
          const cut = S.build * n;
          if (z > cut) return null;
          if (S.xray && (it.tag === 'front' || it.tag === 'tail') && z > n * 0.56) return null;
          out.dx = 0; out.dy = 0; out.dz = 0; out.rot = 0; out.scale = 1;
          if (S.build < 0.999 && z > cut - 1.6) {
            out.dz = (1 - (cut - z) / 1.6) * 5.0;
          }
          return out;
        };
      } else {
        it.each = null;
      }
    }
  }

  const VOXEL_TILT = 18 * Math.PI / 180;
  let lastT = performance.now();

  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    S.simTime += dt * S.timeScale;
    flash = Math.max(0, flash - dt * 3.8);

    if (fallAnimating) {
      S.breakup = Math.min(1.0, S.breakup + dt * 0.22);
      ui.breakup.value = S.breakup;
      ui.lblBreakup.textContent = `${Math.round(S.breakup * 100)}%`;
      if (S.breakup >= 1.0) fallAnimating = false;
    }
    if (printing) {
      S.build = Math.min(1.0, S.build + dt * 0.45);
      if (S.build >= 1.0) printing = false;
    }

    if (camTarget) {
      const k = 1 - Math.exp(-dt * 6.5);
      cam.tx += (camTarget.tx - cam.tx) * k;
      cam.ty += (camTarget.ty - cam.ty) * k;
      cam.tz += (camTarget.tz - cam.tz) * k;
      cam.yaw += (camTarget.yaw - cam.yaw) * k;
      cam.pitch += (camTarget.pitch - cam.pitch) * k;
      cam.dist += (camTarget.dist - cam.dist) * k;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(300, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(300, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    if (S.orbit && !drag) cam.yaw += dt * 0.20;

    const setIdx = S.shell ? 1 : 0;
    const list = statics[setIdx];
    updateSimulation(list, S.simTime);

    const useVoxel = S.voxel === 1 || (S.voxel < 0 && cam.pitch < VOXEL_TILT);
    badge.classList.toggle('on', useVoxel);

    const env = LostScene.light(S.tod, flash);
    const front = list.find((it) => it.tag === 'front');
    const tail = list.find((it) => it.tag === 'tail');
    const fire0 = list.find((it) => it.tag === 'fire');

    // Flickering fire + tear electrical spark + lightning flash lamps
    const sparkOn = Math.sin(S.simTime * 27.0) > 0.35 ? 1.0 : 0.25;
    const lamps = [
      [fire0.x, fire0.y, fire0.z + 4, 52, 1.0, 0.46, 0.12],                       // engine fire glow
      [(front.x + tail.x) * 0.5, (front.y + tail.y) * 0.5, front.z + 8, 42, 0.35 * sparkOn, 0.85 * sparkOn, 1.0 * sparkOn], // cabin tear spark
      [front.x + 8, front.y - 4, front.z + 6, 30, 1.0, 0.84, 0.52],              // cockpit glow
    ];
    if (flash > 0.05) {
      lamps.push([70, 70, 90, 180, 0.7 * flash, 0.85 * flash, 1.2 * flash]);
    }

    E.render({
      cam,
      list,
      atlas: SETS[setIdx].atlas,
      hsr: true,
      fill: true,
      guard: true,
      voxel: useVoxel,
      lod: false,
      heat: 0,
      measure: false,
      scale: S.res,
      shadows: S.shadows,
      ao: S.ao,
      bloom: S.bloom,
      water: pal.names.ocean,
      ground: 1,
      time: S.simTime,
      light: env,
      lamps,
      blobs: [
        [front.x, front.y, front.z + 4, 18, front.z - 2],
        [tail.x, tail.y, tail.z + 6, 15, tail.z - 2],
      ]
    });

    if (S.ditherOn && Dither) {
      Dither.apply(E.stats.iw, E.stats.ih, {
        dither: S.dither,
        levels: S.levels,
        palette: S.palette
      });
    }

    statsEl.textContent =
      `OCEANIC 815 · ${useVoxel ? 'VOXEL' : 'SLICES'}${S.ditherOn ? ' + BAYER' : ''}\n` +
      `interno: ${E.stats.iw}×${E.stats.ih}px (${S.res}×) · cpu ${E.stats.cpuMs.toFixed(1)}ms\n` +
      `queda: ${Math.round(S.breakup * 100)}% · fatias: ${E.stats.slices}`;

    requestAnimationFrame(tick);
  }

  document.body.classList.add('ready');
  requestAnimationFrame(tick);
})();
