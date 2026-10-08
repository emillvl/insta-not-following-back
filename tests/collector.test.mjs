import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = vm.createContext({ URL, location: { origin: 'https://www.instagram.com' } });
vm.runInContext(readFileSync('extension/list-controls.js', 'utf8'), context);
const parse = context.F4FListControls.parseExactCount;
test('count verification accepts exact localized integers but never rounded totals', () => {
  for (const [text, expected] of [['0', 0], ['108', 108], ['10,000', 10000], ['10.000', 10000],
    ['1\u202f234\u202f567', 1234567], ['١٠٬٠٠٠', 10000], ['۱۰٬۰۰۰', 10000], ['１０，０００', 10000]]) {
    assert.equal(parse(text), expected, text);
  }
  for (const text of ['', '1K', '10k', '1.2M', '1万', '1.2', '12,34', '-1', 'Infinity', '9007199254740992']) {
    assert.equal(parse(text), null, text);
  }
});
test('validated runner retains the original comparison and result construction verbatim', () => {
  const source = readFileSync('f4fchecker.js');
  const tail = source.subarray(source.indexOf(Buffer.from('    const followingSet =')));
  assert.notEqual(readFileSync('extension/safe-runner.js').indexOf(tail), -1);
});
