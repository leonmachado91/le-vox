import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const StudioPkg = require('../dist/le-vox.js');
const { Art, Rig, DSL, Importers, Exporters, Prefabs, Engine, Studio } = StudioPkg;

test('DSL.compile builds CSG shapes, hollows interiors, and mirrors cleanly', () => {
  const pal = new Art.Palette();
  pal.add('metal', '#8899aa');
  pal.add('glow', '#ffaa22', 1.0);
  pal.add('rust', '#663322');

  const def = DSL.compile({
    name: 'dsl_pod',
    w: 16, h: 16, layers: 12,
    ops: [
      { op: 'box', min: [-6, -6, 0], max: [6, 6, 8], mat: 'metal' },
      { op: 'hollow', minZ: 1, maxZ: 7 },
      { op: 'ramp', min: [-6, -6, 8], max: [6, 6, 11], dir: '+x', mat: 'metal' },
      { op: 'cyl', a: [0, 4, 4], b: [0, 7, 4], r: 1.5, mat: 'glow', mirrorY: true },
      { op: 'torus', center: [0, 0, 2], R: 5, r: 1.0, mat: 'metal', subtract: true },
      { op: 'noisePaint', onlyOver: 'metal', scale: 0.4, seed: 5, threshold: 0.65, mat: 'rust' },
    ]
  });

  const atlas = new Art.Atlas(1024);
  const st = Art.buildStack(def, pal, atlas, 3);
  assert.ok(st.slices.length >= 10);
  // Center interior at (0, 0, 4) should be hollowed out
  assert.equal(def.fn(0, 0, 4), null);
  // Symmetric mirrored emitters on +/-Y
  assert.equal(def.fn(0, 6, 4), 'glow');
  assert.equal(def.fn(0, -6, 4), 'glow');
});

test('Importers.fromVox decodes binary MagicaVoxel SIZE + XYZI + RGBA chunks', () => {
  // Build a valid 4x3x2 .vox binary buffer in memory
  const buf = new ArrayBuffer(8 + 12 + 24 + 28 + 12 + 1024);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const writeTag = (off, s) => { for (let i = 0; i < 4; i++) u8[off + i] = s.charCodeAt(i); };

  writeTag(0, 'VOX ');
  dv.setInt32(4, 150, true);

  // MAIN chunk (children = rest of file)
  writeTag(8, 'MAIN');
  dv.setInt32(12, 0, true);
  dv.setInt32(16, buf.byteLength - 20, true);

  // SIZE chunk (12 bytes content: 4, 3, 2)
  let p = 20;
  writeTag(p, 'SIZE'); dv.setInt32(p + 4, 12, true); dv.setInt32(p + 8, 0, true);
  dv.setInt32(p + 12, 4, true); dv.setInt32(p + 16, 3, true); dv.setInt32(p + 20, 2, true);
  p += 24;

  // XYZI chunk (4 bytes count=3 + 12 bytes voxels)
  writeTag(p, 'XYZI'); dv.setInt32(p + 4, 16, true); dv.setInt32(p + 8, 0, true);
  dv.setInt32(p + 12, 3, true);
  u8.set([0, 0, 0, 1,   3, 2, 1, 2,   1, 1, 0, 1], p + 16);
  p += 28;

  // RGBA chunk (1024 bytes)
  writeTag(p, 'RGBA'); dv.setInt32(p + 4, 1024, true); dv.setInt32(p + 8, 0, true);
  p += 12;
  u8.set([255, 40, 40, 255], p + 0); // index 1
  u8.set([40, 255, 80, 255], p + 4); // index 2

  const pal = new Art.Palette();
  const def = Importers.fromVox(buf, pal, { name: 'testVox', emissiveIndices: [2] });
  assert.equal(def.w, 4);
  assert.equal(def.h, 3);
  assert.equal(def.layers, 2);

  const atlas = new Art.Atlas(512);
  const st = Art.buildStack(def, pal, atlas, 0);
  assert.equal(st.slices.length, 2);
  assert.ok(pal.names['testVox_1'] > 0);
  assert.ok(pal.names['testVox_2'] > 0);
  // Emissive index 2 must have glow alpha = 255
  assert.equal(pal.rgba[pal.names['testVox_2']][3], 255);
});

test('Importers.fromSliceStrip converts horizontal RGBA strips into stack layers', () => {
  const sliceW = 4, sliceH = 4, layers = 3;
  const imgW = sliceW * layers, imgH = sliceH;
  const rgba = new Uint8Array(imgW * imgH * 4);
  // Paint pixel (1,1) on slice 0 red, slice 2 blue
  const setPx = (z, x, y, r, g, b) => {
    const i = ((y * imgW) + z * sliceW + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  };
  setPx(0, 1, 1, 220, 40, 40);
  setPx(2, 2, 2, 40, 120, 240);

  const pal = new Art.Palette();
  const def = Importers.fromSliceStrip(rgba, imgW, imgH, sliceW, sliceH, pal, { name: 'strip' });
  const atlas = new Art.Atlas(512);
  const st = Art.buildStack(def, pal, atlas, 0);
  assert.equal(st.slices.length, 2); // layer 1 was empty and dropped cleanly
  assert.equal(st.slices[0].z, 0);
  assert.equal(st.slices[1].z, 2);
});

test('All Prefabs build cleanly into a single 2048 atlas without missing materials', () => {
  const pal = new Art.Palette();
  const atlas = new Art.Atlas(2048);

  const defs = [
    Prefabs.coupe(pal),
    Prefabs.airlinerHalf(pal),
    Prefabs.canopyTree(pal),
    Prefabs.palmTree(pal),
    Prefabs.rock(pal),
    Prefabs.brickHouse(pal),
    Prefabs.streetLamp(pal),
    Prefabs.flatGroundTile(pal),
    Prefabs.deskStation(pal),
    Prefabs.crate(pal),
    Prefabs.barrel(pal),
  ];
  for (const d of defs) {
    const st = Art.buildStack(d, pal, atlas, 3);
    assert.ok(st.slices.length > 0, `Empty prefab: ${d.name}`);
  }
  const ch = Prefabs.humanoid(pal, atlas, 3, { visor: true, glowAccent: true });
  assert.ok(ch.parts.head && ch.parts.torso && ch.parts.boot);
  assert.ok(atlas.usage() < 0.25, `Atlas usage unexpectedly high: ${atlas.usage()}`);
});

test('Engine.screenToWorld intersects horizontal ground plane accurately', () => {
  const cam = { mode: 'ortho', tx: 72, ty: 72, tz: 0, yaw: 0.785, pitch: 0.62, dist: 50, fov: 0.66 };
  const center = Engine.screenToWorld(cam, 16 / 9, 0, 0, 0);
  assert.ok(Math.abs(center[0] - 72) < 0.05);
  assert.ok(Math.abs(center[1] - 72) < 0.05);
  assert.equal(center[2], 0);
});

test('Studio.normalizeSpec & defaultLight produce valid deterministic defaults', () => {
  const spec = Studio.normalizeSpec({ entities: [{ asset: 'car', x: 10, y: 20 }] });
  assert.equal(spec.render.shadowSteps, 24);
  assert.equal(spec.entities[0].pitch, 0);
  assert.equal(spec.entities[0].roll, 0);
  const env = Studio.defaultLight(0.55, 0.5);
  assert.equal(env.sun.length, 3);
  assert.ok(env.sunCol[0] > 1.0);
});

test('Exporters.meshFromStack greedy-meshes solid 4x4x4 cube into exact 6 quads (12 tris)', () => {
  const pal = new Art.Palette();
  pal.add('stone', '#778899');
  const def = DSL.compile({
    name: 'cube4',
    w: 4, h: 4, layers: 4,
    ops: [{ op: 'box', min: [-2, -2, 0], max: [2, 2, 3], mat: 'stone' }]
  });
  const atlas = new Art.Atlas(512);
  const st = Art.buildStack(def, pal, atlas, 0);
  const mesh = Exporters.meshFromStack(st, pal);
  assert.equal(mesh.totalQuads, 6);
  assert.equal(mesh.totalTris, 12);
});

test('Exporters.toGLB outputs spec-valid glTF 2.0 binary for complex multi-node scene', () => {
  const pal = new Art.Palette();
  const atlas = new Art.Atlas(2048);
  const car = Art.buildStack(Prefabs.coupe(pal), pal, atlas, 0);
  const lamp = Art.buildStack(Prefabs.streetLamp(pal), pal, atlas, 0);

  const glb = Exporters.toGLB([
    { name: 'carA', stack: car, x: 10, y: 20, z: 1, rot: 0.5, pitch: 0.1, roll: -0.1, scale: 0.65 },
    { name: 'carB', stack: car, x: 30, y: 20, z: 1, rot: 0, scale: 0.65 },
    { name: 'lamp1', stack: lamp, x: 15, y: 10, z: 1, rot: 0, scale: 1 },
  ], pal, { voxelSize: 0.1 });

  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  // Header: 'glTF' (0x46546C67), version 2, exact byteLength
  assert.equal(dv.getUint32(0, true), 0x46546C67);
  assert.equal(dv.getUint32(4, true), 2);
  assert.equal(dv.getUint32(8, true), glb.byteLength);
  assert.equal(glb.byteLength % 4, 0);

  // Chunk 0: JSON
  const jsonLen = dv.getUint32(12, true);
  assert.equal(dv.getUint32(16, true), 0x4E4F534A);
  const jsonText = new TextDecoder().decode(glb.subarray(20, 20 + jsonLen));
  const gltf = JSON.parse(jsonText);

  // Chunk 1: BIN
  const binOff = 20 + jsonLen;
  const binLen = dv.getUint32(binOff, true);
  assert.equal(dv.getUint32(binOff + 4, true), 0x004E4942);
  assert.equal(binOff + 8 + binLen, glb.byteLength);
  assert.equal(gltf.buffers[0].byteLength, binLen);

  // Verify instancing (2 unique meshes for 3 nodes), rotation quaternion & emissives
  assert.equal(gltf.nodes.length, 3);
  assert.equal(gltf.meshes.length, 2);
  assert.equal(gltf.nodes[0].rotation.length, 4);
  assert.ok(gltf.materials.some((m) => Array.isArray(m.emissiveFactor)));

  // Verify every index accessor fits within its POSITION vertex count and binary bounds
  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
      const posAcc = gltf.accessors[prim.attributes.POSITION];
      const idxAcc = gltf.accessors[prim.indices];
      assert.ok(posAcc.min && posAcc.max);
      const bv = gltf.bufferViews[idxAcc.bufferView];
      assert.ok(bv.byteOffset + bv.byteLength <= binLen);
      const binStart = binOff + 8 + bv.byteOffset;
      const indices = idxAcc.componentType === 5125
        ? new Uint32Array(glb.buffer, glb.byteOffset + binStart, idxAcc.count)
        : new Uint16Array(glb.buffer, glb.byteOffset + binStart, idxAcc.count);
      for (let i = 0; i < indices.length; i++) {
        assert.ok(indices[i] < posAcc.count, 'Index out of bounds');
      }
    }
  }
});

test('Exporters.toOBJ produces valid Wavefront OBJ + MTL text', () => {
  const pal = new Art.Palette();
  const atlas = new Art.Atlas(1024);
  const crate = Art.buildStack(Prefabs.crate(pal), pal, atlas, 0);
  const { obj, mtl } = Exporters.toOBJ(crate, pal);
  assert.ok(obj.includes('mtllib '));
  assert.ok(obj.includes('usemtl '));
  assert.ok(obj.includes('\nv '));
  assert.ok(obj.includes('\nvn '));
  assert.ok(obj.includes('\nf '));
  assert.ok(mtl.includes('newmtl '));
  assert.ok(mtl.includes('Kd '));
});
