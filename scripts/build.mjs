import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const originalHash = '6b21281d11d84690d2bbf993b3ac3c0ba6c64cd38bfb4e5dc897443752ee9d23';
const source = readFileSync(new URL('../f4fchecker.js', import.meta.url));
if (createHash('sha256').update(source).digest('hex') !== originalHash) {
  throw new Error('The original checker changed. Restore it before building.');
}
const runner = Buffer.concat([
  Buffer.from('void F4FAdapter.run(async ({ document, alert }) => {\nreturn '),
  source,
  Buffer.from('\n});\n')
]);
writeFileSync(new URL('../extension/checker-runner.js', import.meta.url), runner);
let safe = source.toString('utf8');
const replaceSection = (start, end, replacement) => {
  const from = safe.indexOf(start), to = safe.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error('Original checker boundary not found.');
  safe = safe.slice(0, from) + replacement + safe.slice(to);
};
replaceSection('  async function openList(type) {', '  async function scrollAndCollect() {',
  '  async function openList(type) { await F4FCollector.open(type); }\n\n');
replaceSection('  async function scrollAndCollect() {', '  async function closeModal() {',
  '  async function scrollAndCollect() { return F4FCollector.collect(); }\n\n');
replaceSection('  async function closeModal() {', "  console.log('Starting follower analysis...');",
  '  async function closeModal() { await F4FCollector.close(); }\n\n');
writeFileSync(new URL('../extension/safe-runner.js', import.meta.url),
  'void F4FAdapter.run(async ({ document, alert }) => {\nreturn ' + safe + '\n}, F4FCollector);\n');
console.log('Built reference and validated runners; original checker SHA-256 verified.');
