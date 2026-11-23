#!/usr/bin/env node
// scripts/build_dist.mjs: Builds dist/le-vox.js AND packages portable skill folder dist/le-vox-skill/ (synced to .agents/skills/le-vox/).

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'core/art.js',
  'core/rig.js',
  'core/dsl.js',
  'core/importers.js',
  'core/exporters.js',
  'core/engine.js',
  'prefabs/vehicles.js',
  'prefabs/nature.js',
  'prefabs/architecture.js',
  'prefabs/props.js',
  'prefabs/characters.js',
  'prefabs/index.js',
  'core/studio.js',
];

const parts = [
  "// Le'Vox — Standalone WebGL2 Pixel-Art 3D Engine & Authoring Kit",
  '// Built automatically by scripts/build_dist.mjs. Zero external dependencies.',
  '(function (root) {',
  '  "use strict";',
];

for (const rel of FILES) {
  const src = readFileSync(resolve(ROOT, rel), 'utf8');
  parts.push(`\n  // --- ${rel} ---`);
  parts.push(src);
}

parts.push(`
  const api = {
    Art: root.Art,
    Rig: root.Rig,
    DSL: root.DSL,
    Importers: root.Importers,
    Exporters: root.Exporters,
    Prefabs: root.Prefabs,
    Engine: root.Engine,
    Studio: root.Studio,
  };
  root.LeVox = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
`);

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
const outPath = resolve(ROOT, 'dist/le-vox.js');
const bundleText = parts.join('\n');
writeFileSync(outPath, bundleText, 'utf8');
console.log(`Built ${outPath} (${(Buffer.byteLength(bundleText) / 1024).toFixed(1)} KB)`);

// Populate portable Agent Skill folders: dist/le-vox-skill/ and .agents/skills/le-vox/
const skillTargets = [
  resolve(ROOT, 'dist/le-vox-skill'),
  resolve(ROOT, '.agents/skills/le-vox'),
];
const skillMdSrc = resolve(ROOT, '.agents/skills/le-vox/SKILL.md');
const schemaSrc = resolve(ROOT, 'core/scene-schema.md');
const slicerSrc = resolve(ROOT, 'scripts/views_to_slices.py');

for (const dir of skillTargets) {
  mkdirSync(resolve(dir, 'assets'), { recursive: true });
  mkdirSync(resolve(dir, 'references'), { recursive: true });
  mkdirSync(resolve(dir, 'scripts'), { recursive: true });

  if (dir !== resolve(ROOT, '.agents/skills/le-vox')) {
    copyFileSync(skillMdSrc, resolve(dir, 'SKILL.md'));
  }
  copyFileSync(outPath, resolve(dir, 'assets/le-vox.js'));
  copyFileSync(schemaSrc, resolve(dir, 'references/scene-schema.md'));
  copyFileSync(slicerSrc, resolve(dir, 'scripts/views_to_slices.py'));
}
console.log('Packaged portable skill in dist/le-vox-skill/ and .agents/skills/le-vox/');
