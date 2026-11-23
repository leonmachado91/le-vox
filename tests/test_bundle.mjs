import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Standalone dist/le-vox.js exposes complete public API', () => {
  const bundle = require('../dist/le-vox.js');
  for (const key of ['Art', 'Rig', 'DSL', 'Importers', 'Exporters', 'Prefabs', 'Engine', 'Studio']) {
    assert.ok(bundle[key], `Missing export: ${key}`);
  }
  assert.equal(typeof bundle.Studio.mount, 'function');
  assert.equal(typeof bundle.Engine.screenToWorld, 'function');
  assert.equal(typeof bundle.DSL.compile, 'function');
  assert.equal(typeof bundle.Importers.fromVox, 'function');
  assert.equal(typeof bundle.Importers.fromSliceStrip, 'function');
  assert.equal(typeof bundle.Exporters.toGLB, 'function');
  assert.equal(typeof bundle.Exporters.studioToGLB, 'function');
  assert.equal(typeof bundle.Exporters.toOBJ, 'function');
  assert.equal(typeof bundle.Prefabs.coupe, 'function');
  assert.equal(typeof bundle.Prefabs.humanoid, 'function');
});

test('Portable skill package dist/le-vox-skill/ is self-contained with relative paths only', () => {
  for (const base of ['dist/le-vox-skill', '.agents/skills/le-vox']) {
    for (const rel of ['SKILL.md', 'assets/le-vox.js', 'references/scene-schema.md', 'scripts/views_to_slices.py']) {
      assert.ok(existsSync(resolve(ROOT, base, rel)), `Missing skill file: ${base}/${rel}`);
    }
    const skillMd = readFileSync(resolve(ROOT, base, 'SKILL.md'), 'utf8');
    assert.ok(skillMd.startsWith('---\nname: le-vox\n'), 'Missing YAML frontmatter');
    assert.ok(!skillMd.includes('/home/'), 'SKILL.md must not hardcode machine-specific /home/ paths');
  }
});
