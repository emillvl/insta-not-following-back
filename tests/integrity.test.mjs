import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

test('original checker and embedded runner preserve the recorded bytes', () => {
  const source = readFileSync('f4fchecker.js');
  assert.equal(source.length, 5818);
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '6b21281d11d84690d2bbf993b3ac3c0ba6c64cd38bfb4e5dc897443752ee9d23');
  assert.notEqual(readFileSync('extension/checker-runner.js').indexOf(source), -1);
});
function selectors() {
  const context = vm.createContext({ URL, location: { origin: 'https://www.instagram.com' } });
  vm.runInContext(readFileSync('extension/localization.js', 'utf8'), context);
  return context.F4FSelectors;
}
test('original English/Turkish lookups are always tried unchanged first', () => {
  const mapping = selectors();
  for (const label of ['Close', 'Kapat']) {
    const exact = `div[role="dialog"] svg[aria-label="${label}"]`;
    const calls = [];
    const node = {};
    const result = mapping.querySelector({ querySelector: selector => {
      calls.push(selector); return selector === exact ? node : null;
    } }, exact);
    assert.equal(result, node);
    assert.deepEqual(calls, [exact]);
  }
});
test('additional close labels are handled by the recognition adapter', () => {
  const mapping = selectors();
  for (const label of mapping.closeLabels) {
    const node = {};
    const result = mapping.querySelector({ querySelector: selector =>
      selector === `div[role="dialog"] button[aria-label="${label}"]` ? node : null
    }, 'div[role="dialog"] button[aria-label="Close"]');
    assert.equal(result, node, label);
  }
});
test('other collection selectors are delegated without fallback', () => {
  const calls = [];
  selectors().querySelector({ querySelector: selector => { calls.push(selector); return null; } }, 'div[role="dialog"]');
  assert.deepEqual(calls, ['div[role="dialog"]']);
});
test('identity ignores visited profiles, arbitrary avatars, reserved routes and ambiguous labels', () => {
  const mapping = selectors();
  const link = (href, text, avatar = true, navigation = true) => ({ textContent: text,
    getAttribute: key => key === 'href' ? href : null,
    closest: () => navigation ? {} : null,
    querySelector: () => avatar ? {} : null, querySelectorAll: () => [] });
  const document = links => ({ querySelectorAll: () => links });
  assert.equal(mapping.ownProfile(document([link('/someone_else/', 'Someone else')])), null);
  assert.equal(mapping.ownProfile(document([link('/someone_else/', 'Profile', true, false)])), null);
  assert.equal(mapping.ownProfile(document([link('/me/', 'Profile', false)])), null);
  assert.equal(mapping.ownProfile(document([link('/accounts/', 'Profile')])), null);
  assert.equal(mapping.ownProfile(document([link('/me/', 'Profile'), link('/other/', 'Profile')])), null);
  for (const label of mapping.profileLabels) {
    assert.equal(mapping.ownProfile(document([link('/me/', label)])), 'me');
  }
  assert.equal(mapping.usernameFromHref('https://evil.test/me/'), null);
});
