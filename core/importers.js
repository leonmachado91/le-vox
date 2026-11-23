// core/importers.js: Binary .vox (MagicaVoxel) and 2D slice-strip PNG importers for Art.buildStack.
(function (global) {
  'use strict';

  function toHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Minimal MagicaVoxel .vox parser (SIZE + XYZI + RGBA chunks, first model)
  function fromVox(arrayBuffer, pal, opts) {
    const o = opts || {};
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length < 20 ||
        String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'VOX ') {
      throw new Error('Invalid .vox header');
    }

    let w = 0, h = 0, layers = 0;
    let xyzi = null;
    let rgba = null;
    let pos = 8; // skip 'VOX ' + version (4 bytes)

    const readId = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);

    while (pos + 12 <= bytes.length) {
      const id = readId(pos);
      const contentBytes = dv.getInt32(pos + 4, true);
      const childrenBytes = dv.getInt32(pos + 8, true);
      const dataStart = pos + 12;

      if (id === 'MAIN') {
        pos = dataStart;
        continue;
      }
      if (id === 'SIZE' && w === 0) {
        // MagicaVoxel axes: X, Y (ground), Z (up)
        w = dv.getInt32(dataStart, true);
        h = dv.getInt32(dataStart + 4, true);
        layers = dv.getInt32(dataStart + 8, true);
      } else if (id === 'XYZI' && !xyzi) {
        const count = dv.getInt32(dataStart, true);
        xyzi = bytes.subarray(dataStart + 4, dataStart + 4 + count * 4);
      } else if (id === 'RGBA') {
        rgba = bytes.subarray(dataStart, dataStart + 256 * 4);
      }

      pos = dataStart + contentBytes + childrenBytes;
    }

    if (!w || !h || !layers || !xyzi) throw new Error('Incomplete .vox model (missing SIZE or XYZI)');

    const prefix = o.prefix || (o.name || 'vox') + '_';
    const indexMap = new Uint8Array(256);
    const vox = new Uint8Array(w * h * layers);

    for (let i = 0; i < xyzi.length; i += 4) {
      const vx = xyzi[i], vy = xyzi[i + 1], vz = xyzi[i + 2], ci = xyzi[i + 3];
      if (!ci || vx >= w || vy >= h || vz >= layers) continue;
      if (!indexMap[ci]) {
        const pOff = (ci - 1) * 4;
        const r = rgba ? rgba[pOff] : ((ci * 73) & 255);
        const g = rgba ? rgba[pOff + 1] : ((ci * 151) & 255);
        const b = rgba ? rgba[pOff + 2] : ((ci * 211) & 255);
        const glow = o.emissiveIndices && o.emissiveIndices.includes(ci) ? 1.0 : 0.0;
        indexMap[ci] = pal.ensure(prefix + ci, toHex(r, g, b), glow);
      }
      vox[(vz * h + vy) * w + vx] = indexMap[ci];
    }

    return {
      name: o.name || 'voxModel',
      w, h, layers,
      pad: 0,
      soft: o.soft || 0,
      noShadow: !!o.noShadow,
      vox
    };
  }

  // Convert a horizontal RGBA slice strip (e.g. output of views_to_slices.py) into an Art def.
  // Ground slice z=0 is on the left.
  function fromSliceStrip(rgbaPixels, imgW, imgH, sliceW, sliceH, pal, opts) {
    const o = opts || {};
    const layers = o.layers || Math.floor(imgW / sliceW);
    const prefix = o.prefix || (o.name || 'strip') + '_';
    const quantStep = o.quantStep || 4; // collapse near-identical shades to preserve 255-color palette budget
    const vox = new Uint8Array(sliceW * sliceH * layers);

    for (let z = 0; z < layers; z++) {
      const ox = z * sliceW;
      for (let y = 0; y < sliceH; y++) {
        for (let x = 0; x < sliceW; x++) {
          const p = ((y * imgW) + ox + x) * 4;
          const a = rgbaPixels[p + 3];
          if (a < 128) continue;
          const r = Math.min(255, Math.round(rgbaPixels[p] / quantStep) * quantStep);
          const g = Math.min(255, Math.round(rgbaPixels[p + 1] / quantStep) * quantStep);
          const b = Math.min(255, Math.round(rgbaPixels[p + 2] / quantStep) * quantStep);
          const hex = toHex(r, g, b);
          const id = pal.ensure(prefix + hex, hex, 0);
          vox[(z * sliceH + y) * sliceW + x] = id;
        }
      }
    }

    return {
      name: o.name || 'sliceStrip',
      w: sliceW,
      h: sliceH,
      layers,
      pad: 0,
      soft: o.soft || 0,
      noShadow: !!o.noShadow,
      vox
    };
  }

  // Browser helper: reads an HTMLImageElement / ImageBitmap slice strip via offscreen canvas
  function fromSliceImage(img, sliceW, sliceH, pal, opts) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    return fromSliceStrip(data, c.width, c.height, sliceW, sliceH, pal, opts);
  }

  global.Importers = { fromVox, fromSliceStrip, fromSliceImage };
})(typeof window !== 'undefined' ? window : globalThis);
