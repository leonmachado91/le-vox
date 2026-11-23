# SceneSpec & Studio API Schema

`Studio.mount(canvas, sceneSpec, options)` accepts a declarative JSON-serializable `sceneSpec`.

## `sceneSpec`

```js
{
  atlasSize: 2048,           // 2048 | 4096
  shell: 3,                  // 0 = solid, 3 = surface-only shell (faster)
  world: {
    w: 144, h: 144,
    ground: 1,
    autoTiles: true,
    tileSize: 48,            // keep <= 48 for Voxel Mode 48-step ray walk
    floorColors: { c1: '#262938', c2: '#2d3142', grid: '#363c52' }
  },
  palette: {
    // optional named colors outside prefabs: { name: '#hex' | { hex, glow } }
  },
  assets: {
    myCar: { type: 'prefab', prefab: 'coupe', opts: { colors: { body: '#d9383f' } } },
    myBox: {
      type: 'dsl',
      spec: {
        w: 16, h: 16, layers: 12,
        ops: [
          { op: 'box', min: [-6, -6, 0], max: [6, 6, 10], mat: 'wall' },
          { op: 'hollow' }
        ]
      }
    },
    importedVox: { type: 'vox', buffer: arrayBuffer, opts: { emissiveIndices: [250] } },
    importedStrip: { type: 'sliceStrip', pixels: rgbaUint8, imgW: 432, imgH: 48, sliceW: 24, sliceH: 48 }
  },
  characters: {
    hero: { x: 72, y: 72, z: 1, scale: 0.25, visor: true, glowAccent: true, colors: { jacket: '#2f65ad' } }
  },
  entities: [
    { id: 'car1', asset: 'myCar', x: 72, y: 72, z: 1, rot: -0.3, pitch: 0, roll: 0, scale: 0.65 }
  ],
  lamps: [[34, 51, 32, 48, 1.0, 0.85, 0.55]],
  blobs: [[72, 72, 6, 14, 0.5]],
  camera: { mode: 'persp', tx: 72, ty: 72, tz: 5, yaw: 0.78, pitch: 0.44, dist: 58, fov: 0.66 },
  lighting: { tod: 0.6, flash: 0 },
  render: {
    scale: 3, voxel: true, shadows: true, ao: true, bloom: true,
    shadowSteps: 24, aoSamples: 16,
    dither: { enabled: true, strength: 0.55, levels: 8, outline: 0.25, palette: 'Níveis (Posterize)' }
  },
  autoOrbit: true,
  orbitSpeed: 0.25
}
```

## Instance Methods

- `studio.updateScene(patch)` — updates `lighting`, `render`, `lamps`, `blobs`, `entities`, or `entityUpdates` (`[{ id, x, y, z, rot, pitch, roll, scale, sliceFX }]`).
- `studio.setTime(tSec)` — deterministic time advance (for external clock/timeline drivers).
- `studio.setCamera(patch)` / `studio.getCamera()`
- `studio.screenToWorld(clientX, clientY, planeZ)` — exact raycast onto horizontal plane `z = planeZ`.
- `studio.moveCharacter(id, x, y, heading, dt, headAngle)` — drives IK legs & facing.
- `studio.renderFrame()` — draws a single frame immediately and returns `E.stats`.
- `studio.readPixels()` / `studio.toBlob(mime, quality)` — capture hooks.
- `studio.pause()` / `studio.resume()` / `studio.destroy()` — lifecycle management.
