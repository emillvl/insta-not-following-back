import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { originalHash } from './build.mjs';

const original = readFileSync('f4fchecker.js');
assert.equal(createHash('sha256').update(original).digest('hex'), originalHash);
const runner = readFileSync('extension/checker-runner.js');
assert.notEqual(runner.indexOf(original), -1, 'runner must embed original bytes');
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
assert.deepEqual(manifest.host_permissions, ['https://www.instagram.com/*', 'https://instagram.com/*']);
const files = [manifest.action.default_popup, manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(entry => entry.js), 'adapter.js', 'checker-runner.js', 'popup.css', 'popup.js'];
for (const file of files) readFileSync(`extension/${file}`);
for (const file of readdirSync('extension').filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', `extension/${file}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const code = readFileSync(`extension/${file}`, 'utf8');
  assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|importScripts\s*\(/);
}
assert.doesNotMatch(readFileSync('extension/popup.html', 'utf8'), /\son\w+\s*=|<script[^>]*src=["']https?:/);
console.log('Static checks passed: immutable bytes, MV3 files, scoped permissions, syntax, no remote execution/network clients.');
