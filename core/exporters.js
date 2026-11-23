// core/exporters.js: Greedy-meshed glTF 2.0 (.glb) and Wavefront (.obj + .mtl) exporters.
// Converts Le'Vox voxel stacks & scenes into portable meshes ready for Blender, Godot, and Unreal.
(function (global) {
  'use strict';

  function srgbToLinear(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  // Convert Le'Vox (x, y, z) -> glTF Y-up right-handed (x, z, -y)
  function toGltfVec(x, y, z, yUp) {
    return yUp ? [x, z, -y] : [x, y, z];
  }

  // Exact 3x3 similarity transform M * R_lv * M^T -> glTF quaternion [x, y, z, w]
  function eulerToGltfQuat(yaw, pitch, roll, yUp) {
    const cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
    const cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
    const cr = Math.cos(roll || 0), sr = Math.sin(roll || 0);

    // R_lv = Rz(yaw) * Ry(pitch) * Rx(roll)
    const r00 = cy * cp, r01 = cy * sp * sr - sy * cr, r02 = cy * sp * cr + sy * sr;
    const r10 = sy * cp, r11 = sy * sp * sr + cy * cr, r12 = sy * sp * cr - cy * sr;
    const r20 = -sp,     r21 = cp * sr,                r22 = cp * cr;

    // If not yUp, convert R_lv directly; if yUp, M = [[1,0,0],[0,0,1],[0,-1,0]] -> M*R*M^T
    const m00 = r00, m01 = yUp ? r02 : r01, m02 = yUp ? -r01 : r02;
    const m10 = yUp ? r20 : r10, m11 = yUp ? r22 : r11, m12 = yUp ? -r21 : r12;
    const m20 = yUp ? -r10 : r20, m21 = yUp ? -r12 : r21, m22 = yUp ? r11 : r22;

    const tr = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1.0) * 2;
      qw = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
      qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
      qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
      qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s;
    }
    return [qx, qy, qz, qw];
  }

  // Greedy mesh an Art stack into per-material triangle buckets (with CCW outer winding).
  function meshFromStack(stack, pal, opts) {
    const o = opts || {};
    const yUp = o.yUp !== false;
    const voxelSize = o.voxelSize ?? 0.1;
    const centerXY = o.centerXY !== false;
    const pad = stack.pad || 0;
    const gw = stack.w + pad * 2;
    const gh = stack.h + pad * 2;
    const gn = stack.n;
    const wh = gw * gh;
    const vox = stack.vox;
    if (!vox) throw new Error('Stack has no voxel grid');

    const ox = centerXY ? -gw * 0.5 : 0;
    const oy = centerXY ? -gh * 0.5 : 0;
    const oz = o.centerZ ? -gn * 0.5 : 0;

    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= gw || y >= gh || z >= gn) ? 0 : vox[z * wh + y * gw + x];

    // Buckets keyed by material id (1..255)
    const buckets = new Map();
    const getBucket = (matId) => {
      let b = buckets.get(matId);
      if (!b) {
        b = { matId, pos: [], norm: [], idx: [], vertCount: 0 };
        buckets.set(matId, b);
      }
      return b;
    };

    const addQuad = (matId, p0, p1, p2, p3, nrm) => {
      const b = getBucket(matId);
      const base = b.vertCount;
      const g0 = toGltfVec((p0[0] + ox) * voxelSize, (p0[1] + oy) * voxelSize, (p0[2] + oz) * voxelSize, yUp);
      const g1 = toGltfVec((p1[0] + ox) * voxelSize, (p1[1] + oy) * voxelSize, (p1[2] + oz) * voxelSize, yUp);
      const g2 = toGltfVec((p2[0] + ox) * voxelSize, (p2[1] + oy) * voxelSize, (p2[2] + oz) * voxelSize, yUp);
      const g3 = toGltfVec((p3[0] + ox) * voxelSize, (p3[1] + oy) * voxelSize, (p3[2] + oz) * voxelSize, yUp);
      const gnrm = toGltfVec(nrm[0], nrm[1], nrm[2], yUp);

      b.pos.push(g0[0], g0[1], g0[2], g1[0], g1[1], g1[2], g2[0], g2[1], g2[2], g3[0], g3[1], g3[2]);
      for (let k = 0; k < 4; k++) b.norm.push(gnrm[0], gnrm[1], gnrm[2]);
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      b.vertCount += 4;
    };

    // 6 axis-aligned directions: [axis(0=x,1=y,2=z), step(+1/-1), uAxis, vAxis, uSize, vSize, sSize]
    const DIRS = [
      { ax: 0, dir: 1,  u: 1, v: 2, nu: gh, nv: gn, ns: gw, nrm: [1, 0, 0] },
      { ax: 0, dir: -1, u: 1, v: 2, nu: gh, nv: gn, ns: gw, nrm: [-1, 0, 0] },
      { ax: 1, dir: 1,  u: 0, v: 2, nu: gw, nv: gn, ns: gh, nrm: [0, 1, 0] },
      { ax: 1, dir: -1, u: 0, v: 2, nu: gw, nv: gn, ns: gh, nrm: [0, -1, 0] },
      { ax: 2, dir: 1,  u: 0, v: 1, nu: gw, nv: gh, ns: gn, nrm: [0, 0, 1] },
      { ax: 2, dir: -1, u: 0, v: 1, nu: gw, nv: gh, ns: gn, nrm: [0, 0, -1] },
    ];

    const c = [0, 0, 0];
    for (const D of DIRS) {
      const mask = new Uint16Array(D.nu * D.nv);
      for (let s = 0; s < D.ns; s++) {
        // Fill 2D visibility mask for this slice
        for (let v = 0; v < D.nv; v++) {
          for (let u = 0; u < D.nu; u++) {
            c[D.ax] = s; c[D.u] = u; c[D.v] = v;
            const id = at(c[0], c[1], c[2]);
            if (!id) { mask[v * D.nu + u] = 0; continue; }
            c[D.ax] = s + D.dir;
            const nb = at(c[0], c[1], c[2]);
            mask[v * D.nu + u] = nb ? 0 : id;
          }
        }
        // Greedy merge rectangles of identical materialId
        for (let v = 0; v < D.nv; v++) {
          for (let u = 0; u < D.nu; ) {
            const mat = mask[v * D.nu + u];
            if (!mat) { u++; continue; }
            let w = 1;
            while (u + w < D.nu && mask[v * D.nu + u + w] === mat) w++;
            let h = 1;
            outer: while (v + h < D.nv) {
              for (let k = 0; k < w; k++) {
                if (mask[(v + h) * D.nu + u + k] !== mat) break outer;
              }
              h++;
            }
            for (let dv = 0; dv < h; dv++) {
              for (let du = 0; du < w; du++) mask[(v + dv) * D.nu + u + du] = 0;
            }

            const plane = s + (D.dir > 0 ? 1 : 0);
            const makePt = (uu, vv) => {
              const p = [0, 0, 0];
              p[D.ax] = plane; p[D.u] = uu; p[D.v] = vv;
              return p;
            };
            // Orient quad CCW from outside
            if (D.ax === 0) {
              if (D.dir > 0) addQuad(mat, makePt(u, v), makePt(u + w, v), makePt(u + w, v + h), makePt(u, v + h), D.nrm);
              else           addQuad(mat, makePt(u + w, v), makePt(u, v), makePt(u, v + h), makePt(u + w, v + h), D.nrm);
            } else if (D.ax === 1) {
              if (D.dir > 0) addQuad(mat, makePt(u + w, v), makePt(u, v), makePt(u, v + h), makePt(u + w, v + h), D.nrm);
              else           addQuad(mat, makePt(u, v), makePt(u + w, v), makePt(u + w, v + h), makePt(u, v + h), D.nrm);
            } else {
              if (D.dir > 0) addQuad(mat, makePt(u, v), makePt(u + w, v), makePt(u + w, v + h), makePt(u, v + h), D.nrm);
              else           addQuad(mat, makePt(u, v + h), makePt(u + w, v + h), makePt(u + w, v), makePt(u, v), D.nrm);
            }
            u += w;
          }
        }
      }
    }

    let totalQuads = 0, totalTris = 0;
    for (const b of buckets.values()) {
      totalQuads += b.vertCount / 4;
      totalTris += b.idx.length / 3;
    }
    return { buckets, totalQuads, totalTris };
  }

  function reverseMatNames(pal) {
    const rev = {};
    if (pal && pal.names) {
      Object.keys(pal.names).forEach((k) => { rev[pal.names[k]] = k; });
    }
    return rev;
  }

  // Export one Stack or a list of placed items [{ name, stack, x, y, z, rot, pitch, roll, scale }] to a .glb Uint8Array
  function toGLB(stackOrItems, pal, opts) {
    const o = opts || {};
    const yUp = o.yUp !== false;
    const voxelSize = o.voxelSize ?? 0.1;
    const items = Array.isArray(stackOrItems)
      ? stackOrItems
      : [{ name: stackOrItems.name || 'stack', stack: stackOrItems, x: 0, y: 0, z: 0, rot: 0, pitch: 0, roll: 0, scale: 1 }];

    const revNames = reverseMatNames(pal);
    const gltfMaterials = [];
    const gltfMatByPalId = new Map();

    const ensureGltfMat = (palId) => {
      if (gltfMatByPalId.has(palId)) return gltfMatByPalId.get(palId);
      const rgba = (pal && pal.rgba && pal.rgba[palId]) || [200, 200, 200, 0];
      const r = srgbToLinear(rgba[0]), g = srgbToLinear(rgba[1]), b = srgbToLinear(rgba[2]);
      const glow = (rgba[3] || 0) / 255;
      const mat = {
        name: revNames[palId] || ('mat_' + palId),
        pbrMetallicRoughness: {
          baseColorFactor: [r, g, b, 1.0],
          metallicFactor: 0.05,
          roughnessFactor: 0.85
        }
      };
      if (glow > 0.01) {
        const em = glow * 2.0;
        mat.emissiveFactor = [Math.min(1, r * em), Math.min(1, g * em), Math.min(1, b * em)];
      }
      const idx = gltfMaterials.length;
      gltfMaterials.push(mat);
      gltfMatByPalId.set(palId, idx);
      return idx;
    };

    const binChunks = [];
    let binLen = 0;
    const bufferViews = [];
    const accessors = [];

    const appendBytes = (typedArr, target) => {
      const raw = new Uint8Array(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength);
      const pad = (4 - (raw.byteLength % 4)) % 4;
      const viewIdx = bufferViews.length;
      bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: raw.byteLength, target });
      binChunks.push(raw);
      if (pad) binChunks.push(new Uint8Array(pad));
      binLen += raw.byteLength + pad;
      return viewIdx;
    };

    const meshCache = new Map();
    const gltfMeshes = [];
    const gltfNodes = [];

    const buildMeshForStack = (stack) => {
      if (meshCache.has(stack)) return meshCache.get(stack);
      const { buckets } = meshFromStack(stack, pal, { yUp, voxelSize, centerXY: true, centerZ: false });
      const primitives = [];

      for (const bucket of buckets.values()) {
        const posArr = new Float32Array(bucket.pos);
        const normArr = new Float32Array(bucket.norm);
        const useU32 = bucket.vertCount > 65535;
        const idxArr = useU32 ? new Uint32Array(bucket.idx) : new Uint16Array(bucket.idx);

        // Compute exact bounding box for POSITION accessor (required by glTF 2.0 spec)
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < posArr.length; i += 3) {
          const x = posArr[i], y = posArr[i + 1], z = posArr[i + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        const posView = appendBytes(posArr, 34962);
        const normView = appendBytes(normArr, 34962);
        const idxView = appendBytes(idxArr, 34963);

        const posAcc = accessors.length;
        accessors.push({ bufferView: posView, componentType: 5126, count: bucket.vertCount, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
        const normAcc = accessors.length;
        accessors.push({ bufferView: normView, componentType: 5126, count: bucket.vertCount, type: 'VEC3' });
        const idxAcc = accessors.length;
        accessors.push({ bufferView: idxView, componentType: useU32 ? 5125 : 5123, count: idxArr.length, type: 'SCALAR' });

        primitives.push({
          attributes: { POSITION: posAcc, NORMAL: normAcc },
          indices: idxAcc,
          material: ensureGltfMat(bucket.matId)
        });
      }

      const meshIdx = gltfMeshes.length;
      gltfMeshes.push({ name: stack.name || ('mesh_' + meshIdx), primitives });
      meshCache.set(stack, meshIdx);
      return meshIdx;
    };

    const sceneNodeIndices = [];
    items.forEach((it, idx) => {
      if (!it || !it.stack || !it.stack.vox) return;
      const meshIdx = buildMeshForStack(it.stack);
      const t = toGltfVec((it.x || 0) * voxelSize, (it.y || 0) * voxelSize, (it.z || 0) * voxelSize, yUp);
      const node = {
        name: it.name || it.id || (it.stack.name + '_' + idx),
        mesh: meshIdx,
        translation: t
      };
      if (it.rot || it.pitch || it.roll) {
        node.rotation = eulerToGltfQuat(it.rot || 0, it.pitch || 0, it.roll || 0, yUp);
      }
      const sc = it.scale ?? 1;
      if (sc !== 1) node.scale = [sc, sc, sc];
      sceneNodeIndices.push(gltfNodes.length);
      gltfNodes.push(node);
    });

    const jsonObj = {
      asset: { version: '2.0', generator: "Le'Vox Exporter" },
      scene: 0,
      scenes: [{ name: o.sceneName || 'LeVoxScene', nodes: sceneNodeIndices }],
      nodes: gltfNodes,
      meshes: gltfMeshes,
      materials: gltfMaterials,
      buffers: [{ byteLength: binLen }],
      bufferViews,
      accessors
    };

    const enc = new TextEncoder();
    const rawJson = enc.encode(JSON.stringify(jsonObj));
    const jsonPad = (4 - (rawJson.byteLength % 4)) % 4;
    const jsonLen = rawJson.byteLength + jsonPad;
    const totalLen = 12 + 8 + jsonLen + 8 + binLen;

    const out = new Uint8Array(totalLen);
    const dv = new DataView(out.buffer);
    // GLB Header: magic ('glTF'), version (2), total length
    dv.setUint32(0, 0x46546C67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, totalLen, true);
    // Chunk 0: JSON
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4E4F534A, true);
    out.set(rawJson, 20);
    for (let i = 0; i < jsonPad; i++) out[20 + rawJson.byteLength + i] = 0x20;
    // Chunk 1: BIN
    const binHdr = 20 + jsonLen;
    dv.setUint32(binHdr, binLen, true);
    dv.setUint32(binHdr + 4, 0x004E4942, true);
    let ptr = binHdr + 8;
    for (const c of binChunks) { out.set(c, ptr); ptr += c.byteLength; }

    return out;
  }

  // Export a mounted Studio instance (entities + optional ground) directly to .glb
  function studioToGLB(studio, opts) {
    const o = opts || {};
    const includeGround = !!o.includeGround;
    const spec = studio.spec;
    const items = [];

    spec.entities.forEach((e) => {
      const st = studio.stacks[e.asset];
      if (!st) return;
      if (!includeGround && st.def && st.def.ground) return;
      items.push({
        name: e.id || e.asset,
        stack: st,
        x: e.x, y: e.y, z: e.z,
        rot: e.rot || 0, pitch: e.pitch || 0, roll: e.roll || 0,
        scale: e.scale || 1
      });
    });

    if (includeGround) {
      Object.keys(studio.stacks).forEach((k) => {
        if (!k.startsWith('_ground_')) return;
        const parts = k.split('_');
        const tx = +parts[2], ty = +parts[3], ts = spec.world.tileSize || 48;
        items.push({ name: k, stack: studio.stacks[k], x: tx * ts + ts / 2, y: ty * ts + ts / 2, z: 0, rot: 0, scale: 1 });
      });
    }

    return toGLB(items, studio.palette, o);
  }

  // Export a single Stack to Wavefront OBJ + MTL text pair
  function toOBJ(stack, pal, opts) {
    const o = opts || {};
    const mtlName = o.mtlName || (stack.name || 'levox') + '.mtl';
    const { buckets } = meshFromStack(stack, pal, { yUp: o.yUp !== false, voxelSize: o.voxelSize ?? 0.1, centerXY: true });
    const revNames = reverseMatNames(pal);

    const objLines = ['# Le\'Vox Greedy-Meshed OBJ', 'mtllib ' + mtlName, 'o ' + (stack.name || 'stack')];
    const mtlLines = ['# Le\'Vox Material Library'];
    let vOff = 1, vnOff = 1;

    for (const bucket of buckets.values()) {
      const mName = revNames[bucket.matId] || ('mat_' + bucket.matId);
      const rgba = (pal && pal.rgba && pal.rgba[bucket.matId]) || [200, 200, 200, 0];
      const r = (rgba[0] / 255).toFixed(4), g = (rgba[1] / 255).toFixed(4), b = (rgba[2] / 255).toFixed(4);
      const glow = (rgba[3] || 0) / 255;

      mtlLines.push('newmtl ' + mName, `Kd ${r} ${g} ${b}`, 'Ka 0 0 0', 'Ks 0.05 0.05 0.05');
      if (glow > 0.01) mtlLines.push(`Ke ${(r * glow * 2).toFixed(4)} ${(g * glow * 2).toFixed(4)} ${(b * glow * 2).toFixed(4)}`);

      objLines.push('usemtl ' + mName);
      for (let i = 0; i < bucket.pos.length; i += 3) {
        objLines.push(`v ${bucket.pos[i].toFixed(4)} ${bucket.pos[i + 1].toFixed(4)} ${bucket.pos[i + 2].toFixed(4)}`);
      }
      for (let i = 0; i < bucket.norm.length; i += 3) {
        objLines.push(`vn ${bucket.norm[i].toFixed(2)} ${bucket.norm[i + 1].toFixed(2)} ${bucket.norm[i + 2].toFixed(2)}`);
      }
      for (let i = 0; i < bucket.idx.length; i += 3) {
        const a = bucket.idx[i] + vOff, b2 = bucket.idx[i + 1] + vOff, c = bucket.idx[i + 2] + vOff;
        const na = bucket.idx[i] + vnOff, nb = bucket.idx[i + 1] + vnOff, nc = bucket.idx[i + 2] + vnOff;
        objLines.push(`f ${a}//${na} ${b2}//${nb} ${c}//${nc}`);
      }
      vOff += bucket.vertCount;
      vnOff += bucket.vertCount;
    }

    return { obj: objLines.join('\n') + '\n', mtl: mtlLines.join('\n') + '\n' };
  }

  function downloadGLB(filename, target, palOrOpts, maybeOpts) {
    const isStudio = target && target.stacks && target.palette && target.spec;
    const bytes = isStudio ? studioToGLB(target, palOrOpts) : toGLB(target, palOrOpts, maybeOpts);
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'levox-export.glb';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return bytes;
  }

  global.Exporters = { meshFromStack, toGLB, studioToGLB, toOBJ, downloadGLB };
})(typeof window !== 'undefined' ? window : globalThis);
