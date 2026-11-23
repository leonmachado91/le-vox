---
name: le-vox
description: Render and author 3D pixel-art / sprite-stacked scenes, props, vehicles, and IK characters in WebGL2, plus export greedy-meshed .glb / .obj meshes for Blender, Godot, and Unreal.
---

# Le'Vox

Standalone, agnostic 3D pixel-art / voxel-slice rendering and mesh-export kit. Produces interactive WebGL2 canvases, animated scenes, pixel/frame buffers, and `.glb`/`.obj` 3D assets in **any** project directory with zero external dependencies.

## Bundled Files (Relative to This Skill)

- `assets/le-vox.js` — Single standalone bundle (works offline via `file://`, `<script>`, or Node `require`). Copy it into your target project or inline it when generating standalone HTML outputs.
- `references/scene-schema.md` — Full `sceneSpec` & `Studio` API contract (`skill_view(name='le-vox', file_path='references/scene-schema.md')`).
- `scripts/views_to_slices.py` — Optional 4-view orthographic PNG slicer (`python3 scripts/views_to_slices.py input_4views.png slices.png`). Requires `Pillow` and `numpy`.

## Using in Any Target Project

1. **Browser / Standalone HTML / Plugin / App:**
   Copy `assets/le-vox.js` next to your HTML/app entry (or load it via `<script src="./le-vox.js"></script>`). It registers `window.LeVox` and globals `Art`, `Rig`, `DSL`, `Importers`, `Exporters`, `Prefabs`, `Engine`, `Studio`.
2. **Node.js / Asset Generation Pipelines:**
   `const { Art, DSL, Importers, Exporters, Prefabs } = require('./le-vox.js');` — build models procedurally and write `.glb` or `.obj` files directly to disk without opening a browser.

## Quick Start (Declarative Scene)

```js
const studio = Studio.mount(canvas, {
  world: { w: 144, h: 144, ground: 1, autoTiles: true, tileSize: 48 },
  assets: {
    car: { type: 'prefab', prefab: 'coupe', opts: { colors: { body: '#d9383f' } } },
    house: { type: 'prefab', prefab: 'brickHouse' },
    prop: {
      type: 'dsl',
      spec: {
        w: 16, h: 16, layers: 12,
        ops: [
          { op: 'box', min: [-5, -5, 0], max: [5, 5, 8], mat: 'crate' },
          { op: 'hollow' }
        ]
      }
    }
  },
  palette: { crate: '#8a6242' },
  characters: {
    worker: { x: 64, y: 72, z: 1, scale: 0.25, visor: true }
  },
  entities: [
    { id: 'c1', asset: 'car', x: 72, y: 74, z: 1, rot: -0.3, pitch: 0, roll: 0, scale: 0.65 },
    { id: 'h1', asset: 'house', x: 56, y: 40, z: 1, rot: 0, scale: 1 }
  ],
  lamps: [[56, 52, 24, 42, 1.0, 0.85, 0.55]],
  camera: { mode: 'persp', tx: 72, ty: 72, tz: 5, yaw: 0.78, pitch: 0.44, dist: 58 },
  lighting: { tod: 0.58, flash: 0 },
  render: {
    scale: 3, voxel: true, shadowSteps: 24, aoSamples: 16,
    dither: { enabled: true, strength: 0.55, levels: 8, outline: 0.25 }
  }
});
```

## Core Authoring Rules

1. **Prefer `DSL.compile(spec)` or `Prefabs.*` over raw `fn(x, y, z)` math:**
   - DSL ops: `box`, `cyl` (`a, b, r | rA, rB`), `ellipsoid`, `dome`, `ramp` (`dir: '+x'|'-x'|'+y'|'-y'`), `torus`, `hollow`, `noisePaint`.
   - Modifiers: `subtract: true`, `paintOnly: true`, `onlyOver: 'mat'`, `mirrorY: true`, `mirrorX: true`.
2. **Import external assets cleanly:**
   - MagicaVoxel `.vox`: `{ type: 'vox', buffer: arrayBuffer, opts: { emissiveIndices: [250] } }`
   - 4-view `views_to_slices.py` strips: `{ type: 'sliceStrip', pixels, imgW, imgH, sliceW, sliceH }`
3. **Engine bounds:**
   - Keep ground tiles `<= 48×48` (voxel ray-walk limit is 48 texels per box).
   - Palette holds max `255` materials; reuse materials across assets.
   - Use `pitch` and `roll` directly on entities instead of baking tilt into voxels.
4. **CPU / iGPU-friendly defaults (when no dedicated GPU is present):**
   - `render.scale = 3` (or `4`), `render.voxel = true`, `render.shadowSteps = 16` or `24`, `render.aoSamples = 8` or `16`.

## External Control Hooks (Host-Agnostic)

- `studio.updateScene({ lighting, render, lamps, blobs, entities, entityUpdates })`
- `studio.setTime(tSec)` — deterministic time update (pass `options.loop = false` for external clock drivers)
- `studio.setCamera(camPatch)` / `studio.screenToWorld(clientX, clientY, planeZ)`
- `studio.moveCharacter(id, x, y, heading, dt, headAngle)`
- `studio.renderFrame()` / `studio.readPixels()` / `studio.toBlob(mime, quality)`
- `studio.pause()` / `studio.resume()` / `studio.destroy()`

## Mesh Export (.GLB / .OBJ for Blender, Godot, Unreal)

- `Exporters.toGLB(stackOrItems, pal, { voxelSize: 0.1, yUp: true })` — greedy-meshed glTF 2.0 binary `Uint8Array` (named PBR + emissive materials).
- `Exporters.studioToGLB(studio, { includeGround: false, voxelSize: 0.1 })` — exports a full mounted scene into a multi-node `.glb`.
- `Exporters.toOBJ(stack, pal, opts)` — returns `{ obj, mtl }` strings.
- `Exporters.downloadGLB(filename, stackOrStudio, palOrOpts)` — browser download helper.

## Available Prefabs

- Vehicles: `coupe`, `airlinerHalf`
- Architecture: `brickHouse`, `streetLamp`, `flatGroundTile`
- Nature: `canopyTree`, `palmTree`, `rock`
- Props: `deskStation`, `crate`, `barrel`
- Characters (IK): `humanoid`
