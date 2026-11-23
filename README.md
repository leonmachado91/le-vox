# Le'Vox

Standalone, zero-dependency WebGL2 voxel & sprite-stacking 3D pixel-art engine, procedural CSG DSL, IK walker rig, `.vox`/slice-strip importers, greedy-meshed `.glb`/`.obj` exporters, and portable Agent Skill.

Built on top of the MIT-licensed rendering ideas from [`loktar00/sprite-stack-engine`](https://github.com/loktar00/sprite-stack-engine) and [`danielwh2/sprite-stacking`](https://github.com/danielwh2/sprite-stacking).

## Install as an Agent Skill

```bash
npx skills add leonmachado91/le-vox
```

Or copy `dist/le-vox-skill/` (or `.agents/skills/le-vox/`) into your agent's skills directory (e.g. `~/.hermes/skills/le-vox/` or `~/.claude/skills/le-vox/`). The skill bundle is 100% self-contained (`SKILL.md`, `assets/le-vox.js`, `references/scene-schema.md`, `scripts/views_to_slices.py`).

## Layout

- `core/` — Modular WebGL2 engine (`engine.js`, `art.js`, `rig.js`, `dsl.js`, `importers.js`, `exporters.js`, `studio.js`, `scene-schema.md`, `verify.html`).
- `prefabs/` — Parameterized reusable assets (`vehicles.js`, `nature.js`, `architecture.js`, `props.js`, `characters.js`).
- `dist/le-vox.js` — Single standalone bundle (works in `<script>`, `file://`, and Node `require`).
- `dist/le-vox-skill/` — Self-contained, portable Agent Skill folder.
- `.agents/skills/le-vox/` — Standard `.agents/skills` discovery copy (synced by `scripts/build_dist.mjs`).
- `scripts/` — `build_dist.mjs` (builds `dist/le-vox.js` + skill bundles) and `views_to_slices.py` (4-view PNG slicer).
- `tests/` — Automated Node test suite (`node --test tests/*.mjs`).
- `scenes/` — Standalone `file://`-ready demos and games:
  - `turbo86-garage/` — TURBO-86 coupe + corner garage.
  - `lost-crash/` — Oceanic 815 bullet-time mid-air breakup.
  - `neon-arena/` — Isometric twin-stick shooter.

## Build & Test

```bash
node scripts/build_dist.mjs
node --test tests/*.mjs
```

Open `core/verify.html` (or any demo under `scenes/*/index.html`) directly in a WebGL2 browser (`file://`, no server required).

## Quick Example (Browser or Node)

```js
// Export a procedural coupe to .glb for Blender, Godot, or Unreal:
const { Art, Prefabs, Exporters } = require('./dist/le-vox.js');
const pal = new Art.Palette();
const atlas = new Art.Atlas(1024);
const coupe = Art.buildStack(Prefabs.coupe(pal), pal, atlas, 0);
const glbBytes = Exporters.toGLB(coupe, pal, { voxelSize: 0.1 });
```

## 4-View Sheet to Slices (Python)

Requires `Pillow` and `numpy`:

```bash
python3 scripts/views_to_slices.py input_4views.png slices.png --preview check.png --html viewer.html
```
