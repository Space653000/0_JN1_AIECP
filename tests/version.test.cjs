'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVersion, parseVersion, compareVersions, versionFromTag } = require('../electron/lib/version.cjs');

test('normalizes release tags', () => {
  assert.equal(normalizeVersion('v0.1.0'), '0.1.0');
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.equal(versionFromTag('v2.0.1'), '2.0.1');
});

test('compares semantic versions', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
});
