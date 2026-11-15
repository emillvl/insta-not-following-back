import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { checkerRunners } from './build.mjs';

const original = readFileSync('f4fchecker.js');
const { reference, production } = checkerRunners(original);
assert.ok(readFileSync('extension/checker-runner.js').equals(reference), 'Reference runner is stale. Run npm run build.');
assert.ok(readFileSync('extension/safe-runner.js').equals(production), 'Production runner is stale. Run npm run build.');
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'webRequest']);
assert.deepEqual(manifest.host_permissions, ['https://www.instagram.com/*', 'https://instagram.com/*']);
for (const size of [16, 32, 48, 128]) {
  const path = manifest.icons?.[size];
  assert.ok(path, `missing ${size}px extension icon`);
  const png = readFileSync(`extension/${path}`);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  if (size !== 128) assert.equal(manifest.action.default_icon?.[size], path);
}
const files = [manifest.action.default_popup, manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(entry => entry.js), 'collector.js', 'adapter.js', 'checker-runner.js', 'safe-runner.js', 'popup.css', 'popup.js',
  'icons/logo-light-128.png', 'icons/logo-512.png', 'icons/logo-1024.png'];
for (const file of files) readFileSync(`extension/${file}`);
for (const file of readdirSync('extension').filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', `extension/${file}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const code = readFileSync(`extension/${file}`, 'utf8');
  assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|importScripts\s*\(/);
}
assert.doesNotMatch(readFileSync('extension/popup.html', 'utf8'), /\son\w+\s*=|<script[^>]*src=["']https?:/);
console.log('Static checks passed: immutable bytes, MV3 files, scoped permissions, syntax, no remote execution/network clients.');
