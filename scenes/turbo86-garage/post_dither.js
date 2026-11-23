// post_dither.js: Optional Bayer 4x4 dithering + palette/color quantization pass
// layered cleanly over engine.js without modifying upstream files.
(function (global) {
  'use strict';

  const VS = `#version 300 es
  out vec2 v_uv;
  void main() {
    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
    v_uv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  const FS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_src;
  uniform vec2 u_grid;       // internal pixel-art resolution (iw, ih)
  uniform float u_dither;    // 0..1 strength
  uniform float u_levels;    // > 1.5 for uniform channel quantization when paletteMode == 0
  uniform int u_palSize;     // > 0 for OKLab palette quantization
  uniform vec3 u_pal[32];
  out vec4 fragColor;

  float bayer4x4(vec2 px) {
    int x = int(mod(px.x, 4.0));
    int y = int(mod(px.y, 4.0));
    int i = y * 4 + x;
    float m[16] = float[16](
      0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
     12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
      3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
     15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
    );
    return m[i] - 0.5;
  }

  vec3 rgbToOklab(vec3 c) {
    c = pow(max(c, vec3(0.0)), vec3(2.2));
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    float l_ = pow(max(l, 0.0), 1.0 / 3.0);
    float m_ = pow(max(m, 0.0), 1.0 / 3.0);
    float s_ = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3(
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
  }

  void main() {
    // Snap sampling exactly to the engine's internal pixel-art grid
    vec2 px = floor(v_uv * u_grid);
    vec2 uv = (px + 0.5) / u_grid;
    vec3 col = texture(u_src, vec2(uv.x, 1.0 - uv.y)).rgb;

    float b = bayer4x4(px);

    if (u_palSize > 0) {
      vec3 dCol = clamp(col + vec3(b * u_dither * 0.14), 0.0, 1.0);
      vec3 lab = rgbToOklab(dCol);
      float bestDist = 1e9;
      vec3 best = dCol;
      for (int i = 0; i < 32; i++) {
        if (i >= u_palSize) break;
        vec3 d = lab - rgbToOklab(u_pal[i]);
        float dist = d.x * d.x * 1.25 + d.y * d.y + d.z * d.z;
        if (dist < bestDist) {
          bestDist = dist;
          best = u_pal[i];
        }
      }
      col = best;
    } else if (u_levels > 1.5) {
      float stepSize = 1.0 / (u_levels - 1.0);
      vec3 dCol = clamp(col + vec3(b * stepSize * u_dither), 0.0, 1.0);
      col = floor(dCol * (u_levels - 1.0) + 0.5) / (u_levels - 1.0);
    }

    fragColor = vec4(col, 1.0);
  }`;

  const PALETTES = {
    'Níveis (Posterize)': [],
    'Turbo Retro (24)': [
      '#10121c','#1d2030','#2d3145','#444d63','#697187','#9ea6bd',
      '#d6dce8','#f3efe2','#9c1f31','#d9383f','#ff594f','#ffbe47',
      '#ffe599','#7c4c48','#a36b5e','#3b6647','#5b9654','#2e729e',
      '#58b4de','#4ef2ff','#ff598f','#e09f3e','#356b9c','#f56a2c'
    ],
    'Endesga 16': [
      '#141013','#3b1725','#73172d','#b4202a','#df3e23','#fa6a0a',
      '#f9a31b','#ffd541','#fffc40','#d6f264','#9cdb43','#59c135',
      '#14a02e','#1a7a3e','#24523b','#122020'
    ],
    'Pico-8': [
      '#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f',
      '#c2c3c7','#fff1e8','#ff004d','#ffa300','#ffec27','#00e436',
      '#29adff','#83769c','#ff77a8','#ffccaa'
    ],
    'GameBoy Pocket': [
      '#0f1914','#243b2c','#486e4c','#7ca66c','#b8d492','#e8f5c8'
    ]
  };

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function create(srcCanvas, dstCanvas) {
    const gl = dstCanvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return null;

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

    const vao = gl.createVertexArray();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const loc = {
      src: gl.getUniformLocation(prog, 'u_src'),
      grid: gl.getUniformLocation(prog, 'u_grid'),
      dither: gl.getUniformLocation(prog, 'u_dither'),
      levels: gl.getUniformLocation(prog, 'u_levels'),
      palSize: gl.getUniformLocation(prog, 'u_palSize'),
      pal: gl.getUniformLocation(prog, 'u_pal'),
    };

    const palBuf = new Float32Array(32 * 3);

    return {
      palettes: Object.keys(PALETTES),
      apply: function (iw, ih, opt) {
        if (dstCanvas.width !== srcCanvas.width || dstCanvas.height !== srcCanvas.height) {
          dstCanvas.width = srcCanvas.width;
          dstCanvas.height = srcCanvas.height;
        }
        gl.viewport(0, 0, dstCanvas.width, dstCanvas.height);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
        gl.uniform1i(loc.src, 0);
        gl.uniform2f(loc.grid, iw, ih);
        gl.uniform1f(loc.dither, opt.dither);
        gl.uniform1f(loc.levels, opt.levels);

        const list = PALETTES[opt.palette] || [];
        for (let i = 0; i < Math.min(32, list.length); i++) {
          const c = hexToRgb(list[i]);
          palBuf[i * 3] = c[0]; palBuf[i * 3 + 1] = c[1]; palBuf[i * 3 + 2] = c[2];
        }
        gl.uniform3fv(loc.pal, palBuf);
        gl.uniform1i(loc.palSize, list.length);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }

  global.PostDither = { create };
})(window);
