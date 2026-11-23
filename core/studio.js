// core/studio.js: Agnostic scene orchestrator over Engine, Art, DSL, Importers, Rig, and Prefabs.
(function (global) {
  'use strict';

  function defaultLight(t, flash) {
    const K = [
      { t: 0.0, el: 42, az: -38, sun: [1.36, 1.24, 1.0], sky: [0.42, 0.52, 0.68], bounce: [0.32, 0.28, 0.18], haze: [0.84, 0.88, 0.94], hazeK: 0.14, glow: 0.15, exposure: 1.02 },
      { t: 0.55, el: 16, az: -20, sun: [1.56, 0.98, 0.50], sky: [0.35, 0.38, 0.62], bounce: [0.32, 0.22, 0.14], haze: [0.94, 0.72, 0.56], hazeK: 0.28, glow: 0.55, exposure: 1.05 },
      { t: 1.0, el: 7, az: 12, sun: [0.46, 0.40, 0.70], sky: [0.20, 0.23, 0.42], bounce: [0.15, 0.12, 0.18], haze: [0.16, 0.18, 0.30], hazeK: 0.32, glow: 1.0, exposure: 1.15 }
    ];
    t = Math.max(0, Math.min(1, t ?? 0.5));
    const b = t < K[1].t ? 1 : 2, A = K[b - 1], B = K[b];
    let u = (t - A.t) / (B.t - A.t);
    u = u * u * (3 - 2 * u);
    const mix = (k) => typeof A[k] === 'number'
      ? A[k] + (B[k] - A[k]) * u
      : A[k].map((v, i) => v + (B[k][i] - v) * u);
    const el = mix('el') * Math.PI / 180, az = mix('az') * Math.PI / 180;
    const sunCol = mix('sun'), skyCol = mix('sky'), hazeCol = mix('haze');
    if (flash > 0.01) {
      sunCol[0] += flash * 1.4; sunCol[1] += flash * 1.6; sunCol[2] += flash * 2.2;
      skyCol[0] += flash * 0.5; skyCol[1] += flash * 0.7; skyCol[2] += flash * 1.1;
    }
    return {
      sun: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
      sunCol, skyCol, bounceCol: mix('bounce'),
      hazeCol, hazeK: mix('hazeK'), glow: mix('glow'),
      exposure: mix('exposure'), outer: [0.14, 0.18, 0.26], cloud: 0
    };
  }

  function normalizeSpec(raw) {
    const s = raw || {};
    return {
      atlasSize: s.atlasSize || 2048,
      shell: s.shell ?? 3,
      world: Object.assign({ w: 144, h: 144, ground: 1, autoTiles: true, tileSize: 48, floorColors: null }, s.world),
      palette: s.palette || {},
      assets: s.assets || {},
      characters: s.characters || {},
      entities: (s.entities || []).map((e) => Object.assign({ x: 0, y: 0, z: 0, rot: 0, pitch: 0, roll: 0, scale: 1 }, e)),
      lamps: s.lamps ? s.lamps.slice() : [],
      blobs: s.blobs ? s.blobs.slice() : [],
      camera: Object.assign({ mode: 'persp', tx: 72, ty: 72, tz: 4, yaw: 0.78, pitch: 0.45, dist: 62, fov: 38 * Math.PI / 180 }, s.camera),
      lighting: Object.assign({ tod: 0.55, flash: 0 }, s.lighting),
      render: Object.assign({
        scale: 3, voxel: true, shadows: true, ao: true, bloom: true,
        shadowSteps: 24, aoSamples: 16, hsr: true, fill: true, guard: true,
        water: null, dither: { enabled: false, strength: 0.6, levels: 8, outline: 0, palette: null }
      }, s.render),
      autoOrbit: !!s.autoOrbit,
      orbitSpeed: s.orbitSpeed ?? 0.25
    };
  }

  function makeSliceFX(fx) {
    if (!fx) return null;
    const build = fx.build ?? 1.0;
    const explode = fx.explode ?? 0.0;
    const maxLayer = fx.maxLayer ?? 9999;
    if (build >= 0.999 && explode <= 0.001 && maxLayer >= 9999) return null;
    return (z, n, out) => {
      if (z > maxLayer || z > build * n) return null;
      out.dx = 0; out.dy = 0; out.dz = 0; out.rot = 0; out.scale = 1;
      if (build < 0.999 && z > build * n - 1.5) {
        out.dz += (1 - (build * n - z) / 1.5) * 5.0;
      }
      if (explode > 0.001 && z > 1) {
        out.dz += z * explode * 1.25;
      }
      return out;
    };
  }

  function mount(canvas, sceneSpec, options) {
    const opts = options || {};
    const spec = normalizeSpec(sceneSpec);
    const E = Engine.create(canvas);
    const pal = new Art.Palette();
    const atlas = new Art.Atlas(spec.atlasSize);

    // 1. Register explicit palette entries
    Object.keys(spec.palette).forEach((name) => {
      const v = spec.palette[name];
      if (typeof v === 'string') pal.ensure(name, v, 0);
      else pal.ensure(name, v.hex, v.glow || 0);
    });

    // 2. Build assets (prefab | dsl | raw | vox | sliceStrip)
    const stacks = {};
    const registerDef = (key, def) => {
      stacks[key] = Art.buildStack(def, pal, atlas, spec.shell);
    };

    if (spec.world.autoTiles) {
      const ts = spec.world.tileSize || 48;
      const nx = Math.max(1, Math.ceil(spec.world.w / ts));
      const ny = Math.max(1, Math.ceil(spec.world.h / ts));
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          const def = Prefabs.flatGroundTile(pal, {
            name: `_ground_${tx}_${ty}`,
            size: ts,
            colors: spec.world.floorColors,
            seed: tx * 13 + ty * 37
          });
          registerDef(def.name, def);
        }
      }
    }

    Object.keys(spec.assets).forEach((key) => {
      const a = spec.assets[key];
      if (a.type === 'prefab') {
        const fn = Prefabs[a.prefab];
        if (!fn) throw new Error('Unknown prefab: ' + a.prefab);
        registerDef(key, fn(pal, Object.assign({ name: key }, a.opts)));
      } else if (a.type === 'dsl') {
        registerDef(key, DSL.compile(Object.assign({ name: key }, a.spec)));
      } else if (a.type === 'vox') {
        registerDef(key, Importers.fromVox(a.buffer, pal, Object.assign({ name: key }, a.opts)));
      } else if (a.type === 'sliceStrip') {
        registerDef(key, Importers.fromSliceStrip(a.pixels, a.imgW, a.imgH, a.sliceW, a.sliceH, pal, Object.assign({ name: key }, a.opts)));
      } else if (a.type === 'raw') {
        registerDef(key, Object.assign({ name: key }, a.def));
      }
    });

    // 3. Build parameterized characters
    const chars = {};
    Object.keys(spec.characters).forEach((cid) => {
      const cSpec = spec.characters[cid];
      const built = Prefabs.humanoid(pal, atlas, spec.shell, Object.assign({ name: 'ch_' + cid }, cSpec));
      const walker = Rig.createWalker(built.cfg);
      Rig.place(walker, (cSpec.x || 0) / (cSpec.scale || 0.25), (cSpec.y || 0) / (cSpec.scale || 0.25), cSpec.rot || 0);
      chars[cid] = {
        spec: cSpec,
        built,
        walker,
        scale: cSpec.scale || 0.25,
        lift: cSpec.z ?? spec.world.ground,
        headAngle: cSpec.headAngle
      };
    });

    const atlasTex = E.makeAtlas(atlas.data, atlas.size);
    E.setPalette(pal.bytes());

    // 4. Build initial items & static height map
    const groundItems = [];
    if (spec.world.autoTiles) {
      const ts = spec.world.tileSize || 48;
      const nx = Math.max(1, Math.ceil(spec.world.w / ts));
      const ny = Math.max(1, Math.ceil(spec.world.h / ts));
      for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
        groundItems.push({ stack: stacks[`_ground_${tx}_${ty}`], x: tx * ts + ts / 2, y: ty * ts + ts / 2, z: 0, rot: 0, scale: 1 });
      }
    }

    function makeItem(e) {
      const st = stacks[e.asset];
      if (!st) throw new Error('Unknown asset in entity: ' + e.asset);
      return {
        id: e.id || null,
        stack: st,
        x: e.x, y: e.y, z: e.z,
        rot: e.rot || 0, pitch: e.pitch || 0, roll: e.roll || 0,
        scale: e.scale || 1,
        sway: e.sway || 0,
        only: e.only ?? -1,
        shx: 0, shy: 0,
        each: makeSliceFX(e.sliceFX),
        _baseX: e.x, _baseY: e.y, _baseZ: e.z, _baseRot: e.rot || 0,
        shadow: e.shadow !== false
      };
    }

    let items = spec.entities.map(makeItem);

    function rebuildHeightMap() {
      const W = spec.world.w, H = spec.world.h;
      const hm = new Uint8Array(W * H);
      hm.fill((spec.world.ground || 0) * 2);
      items.forEach((it) => {
        if (!it.shadow || it.stack.def.noShadow || it.stack.def.ground) return;
        const st = it.stack, d = st.def, c = Math.cos(it.rot), s = Math.sin(it.rot);
        for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
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
            if (cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1 && v > hm[cy * W + cx]) hm[cy * W + cx] = v;
          }
        }
      });
      E.setHeightMap(hm, W, H);
    }
    rebuildHeightMap();

    // 5. ResizeObserver + Visibility pause + Optional Orbit
    let simTime = 0;
    let paused = false;
    let rafId = 0;
    let lastNow = performance.now();
    let drag = null;

    function syncSize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(128, Math.round((canvas.clientWidth || canvas.width || 640) * dpr));
      const ch = Math.max(128, Math.round((canvas.clientHeight || canvas.height || 360) * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
    }
    syncSize();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncSize);
      ro.observe(canvas);
    }

    let interactiveOrbit = opts.interactive !== false;
    const onDown = (e) => {
      if (!interactiveOrbit) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = spec.camera.dist * 0.0014;
        const sy = Math.sin(spec.camera.yaw), cy = Math.cos(spec.camera.yaw);
        spec.camera.tx -= (dx * sy - dy * cy) * k;
        spec.camera.ty += (dx * cy + dy * sy) * k;
      } else {
        spec.camera.yaw -= dx * 0.007;
        spec.camera.pitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, spec.camera.pitch + dy * 0.006));
      }
    };
    const onUp = () => { drag = null; };
    const onWheel = (e) => {
      if (!interactiveOrbit) return;
      e.preventDefault();
      spec.camera.dist = Math.max(12, Math.min(240, spec.camera.dist + e.deltaY * 0.05));
    };
    const onCtx = (e) => { if (interactiveOrbit) e.preventDefault(); };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);

    const onVis = () => {
      if (document.hidden) paused = true;
    };
    document.addEventListener('visibilitychange', onVis);

    const api = {
      engine: E,
      atlas,
      palette: pal,
      stacks,
      characters: chars,
      get spec() { return spec; },

      setCamera(camPatch) {
        Object.assign(spec.camera, camPatch);
      },
      getCamera() {
        return Object.assign({}, spec.camera);
      },
      screenToWorld(clientX, clientY, planeZ) {
        const rect = canvas.getBoundingClientRect();
        const nx = ((clientX - rect.left) / (rect.width || 1)) * 2 - 1;
        const ny = 1 - ((clientY - rect.top) / (rect.height || 1)) * 2;
        return Engine.screenToWorld(spec.camera, canvas.width / canvas.height, nx, ny, planeZ ?? spec.world.ground);
      },
      setTime(tSec) {
        simTime = tSec;
        for (const it of items) {
          if (it.sway) {
            it.shx = Math.sin(simTime * 1.7 + it.x) * it.sway;
            it.shy = Math.cos(simTime * 1.3 + it.y) * it.sway * 0.7;
          }
        }
        if (opts.onUpdate) opts.onUpdate(simTime, 0, api);
      },
      moveCharacter(id, x, y, heading, dt, headAngle) {
        const ch = chars[id];
        if (!ch) return;
        Rig.step(ch.walker, x / ch.scale, y / ch.scale, heading, dt || 1 / 60);
        if (headAngle !== undefined) ch.headAngle = headAngle;
      },
      updateScene(patch) {
        if (!patch) return;
        if (patch.lighting) Object.assign(spec.lighting, patch.lighting);
        if (patch.render) Object.assign(spec.render, patch.render);
        if (patch.lamps) spec.lamps = patch.lamps;
        if (patch.blobs) spec.blobs = patch.blobs;
        if (patch.entities) {
          items = patch.entities.map(makeItem);
          rebuildHeightMap();
        }
        if (patch.entityUpdates) {
          for (const u of patch.entityUpdates) {
            const target = items.find((it) => it.id === u.id);
            if (!target) continue;
            if (u.x !== undefined) target.x = u.x;
            if (u.y !== undefined) target.y = u.y;
            if (u.z !== undefined) target.z = u.z;
            if (u.rot !== undefined) target.rot = u.rot;
            if (u.pitch !== undefined) target.pitch = u.pitch;
            if (u.roll !== undefined) target.roll = u.roll;
            if (u.scale !== undefined) target.scale = u.scale;
            if (u.sliceFX !== undefined) target.each = makeSliceFX(u.sliceFX);
          }
        }
      },
      renderFrame() {
        syncSize();
        const list = groundItems.concat(items);
        Object.keys(chars).forEach((cid) => {
          const ch = chars[cid];
          ch.built.draw(list, ch.walker, ch.scale, ch.lift, ch.headAngle);
        });
        const env = defaultLight(spec.lighting.tod, spec.lighting.flash);
        const waterId = spec.render.water ? (pal.names[spec.render.water] ?? -9) : -9;
        E.render({
          cam: spec.camera,
          list,
          atlas: atlasTex,
          hsr: spec.render.hsr,
          fill: spec.render.fill,
          guard: spec.render.guard,
          voxel: spec.render.voxel === 'auto' ? spec.camera.pitch < 0.32 : !!spec.render.voxel,
          lod: false,
          heat: 0,
          measure: false,
          scale: spec.render.scale,
          shadows: spec.render.shadows,
          ao: spec.render.ao,
          bloom: spec.render.bloom,
          shadowSteps: spec.render.shadowSteps,
          aoSamples: spec.render.aoSamples,
          dither: spec.render.dither,
          water: waterId,
          ground: spec.world.ground,
          time: simTime,
          light: env,
          lamps: spec.lamps,
          blobs: spec.blobs
        });
        return E.stats;
      },
      readPixels() {
        const w = canvas.width, h = canvas.height;
        const buf = new Uint8Array(w * h * 4);
        E.gl.bindFramebuffer(E.gl.FRAMEBUFFER, null);
        E.gl.readPixels(0, 0, w, h, E.gl.RGBA, E.gl.UNSIGNED_BYTE, buf);
        return { width: w, height: h, data: buf };
      },
      toBlob(type, quality) {
        return new Promise((resolve) => canvas.toBlob(resolve, type || 'image/png', quality));
      },
      setInteractiveOrbit(enabled) { interactiveOrbit = !!enabled; },
      pause() { paused = true; },
      resume() {
        if (!paused) return;
        paused = false;
        lastNow = performance.now();
      },
      destroy() {
        cancelAnimationFrame(rafId);
        if (ro) ro.disconnect();
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onCtx);
        document.removeEventListener('visibilitychange', onVis);
        E.destroy();
      }
    };

    if (opts.loop !== false) {
      const tick = (now) => {
        rafId = requestAnimationFrame(tick);
        if (paused) return;
        const dt = Math.min(0.05, (now - lastNow) / 1000);
        lastNow = now;
        simTime += dt;
        if (spec.autoOrbit && !drag) spec.camera.yaw += dt * spec.orbitSpeed;
        for (const it of items) {
          if (it.sway) {
            it.shx = Math.sin(simTime * 1.7 + it.x) * it.sway;
            it.shy = Math.cos(simTime * 1.3 + it.y) * it.sway * 0.7;
          }
        }
        if (opts.onUpdate) opts.onUpdate(simTime, dt, api);
        api.renderFrame();
      };
      rafId = requestAnimationFrame(tick);
    } else {
      api.renderFrame();
    }

    return api;
  }

  global.Studio = { mount, normalizeSpec, defaultLight };
})(typeof window !== 'undefined' ? window : globalThis);
