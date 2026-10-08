import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { originalHash } from './build.mjs';

const original = readFileSync('f4fchecker.js');
assert.equal(createHash('sha256').update(original).digest('hex'), originalHash);
const runner = readFileSync('extension/checker-runner.js');
assert.notEqual(runner.indexOf(original), -1, 'runner must embed original bytes');
const comparisonTail = original.subarray(original.indexOf(Buffer.from('    const followingSet =')));
assert.notEqual(readFileSync('extension/safe-runner.js').indexOf(comparisonTail), -1,
  'validated runner must retain the original comparison and output bytes');
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
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
