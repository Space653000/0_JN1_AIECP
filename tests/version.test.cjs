'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVersion, parseVersion, compareVersions, versionFromTag, selectHighestRelease, selectInstallerAsset } = require('../electron/lib/version.cjs');

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


test('selects the highest release independent of list order', () => {
  const release = selectHighestRelease([
    { tagName: 'v0.1.0' },
    { tagName: 'v0.3.0' },
    { tagName: 'not-a-version' },
    { tagName: 'v0.2.5' }
  ]);
  assert.equal(release.tagName, 'v0.3.0');
});

test('prefers the auto-detect installer and falls back by architecture', () => {
  const assets = [
    { name: 'AI-Engineering-Control-Plane-Setup-0.2.0.exe' },
    { name: 'AI-Engineering-Control-Plane-Setup-arm64-0.2.0.exe' }
  ];
  assert.equal(selectInstallerAsset(assets, '0.2.0', 'arm64'), 'AI-Engineering-Control-Plane-Setup-0.2.0.exe');
  assert.equal(
    selectInstallerAsset([{ name: 'AI-Engineering-Control-Plane-Setup-arm64-0.2.0.exe' }], '0.2.0', 'arm64'),
    'AI-Engineering-Control-Plane-Setup-arm64-0.2.0.exe'
  );
  assert.equal(selectInstallerAsset([], '0.2.0', 'x64'), null);
});
