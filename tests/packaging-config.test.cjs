'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { selectInstallerAsset } = require('../electron/lib/version.cjs');

// The real package.json is the packaging configuration the installers are built from; these are configuration values.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const NSIS = pkg.build.nsis;

test('B07-CFG the primary installer is one auto-detect x64+ARM64 build with an architecture-free file name', () => {
  const script = pkg.scripts['dist:auto'];
  assert.match(script, /--win nsis/);
  assert.match(script, /--x64/);
  assert.match(script, /--arm64/, 'the primary build contains both payloads');
  assert.match(script, /artifactName=AI-Engineering-Control-Plane-Setup-\$\{version\}\.\$\{ext\}/, 'the name has no architecture: ordinary users never choose one');
  assert.equal(pkg.build.win.target, 'nsis');
});

test('B07-CFG the x64 and ARM64 fallback installers remain separate, architecture-named builds', () => {
  assert.match(pkg.scripts['dist:x64'], /--x64/);
  assert.doesNotMatch(pkg.scripts['dist:x64'], /--arm64/);
  assert.match(pkg.scripts['dist:arm64'], /--arm64/);
  assert.doesNotMatch(pkg.scripts['dist:arm64'], /--x64/);
  assert.equal(pkg.build.win.artifactName, 'AI-Engineering-Control-Plane-Setup-${arch}-${version}.${ext}');
});

test('B07-CFG the installer is per-user, needs no Administrator and shows an installer UI', () => {
  assert.equal(NSIS.perMachine, false);
  assert.equal(NSIS.oneClick, false, 'a full installer UI (directory choice, shortcut options) is shown');
  assert.equal(NSIS.allowToChangeInstallationDirectory, true);
  assert.notEqual(pkg.build.win.requestedExecutionLevel, 'requireAdministrator');
});

test('B07-CFG the installer creates a Start Menu shortcut, a Desktop shortcut offered through the installer UI, and an uninstall entry', () => {
  assert.equal(NSIS.createStartMenuShortcut, true);
  assert.equal(NSIS.createDesktopShortcut, true);
  assert.equal(NSIS.oneClick, false);
  assert.equal(NSIS.shortcutName, 'AI Engineering Control Plane');
  assert.equal(NSIS.uninstallDisplayName, 'AI Engineering Control Plane');
});

test('B07-CFG uninstalling keeps the user configuration and evidence', () => {
  assert.equal(NSIS.deleteAppDataOnUninstall, false);
});

test('B07-CFG the real main process never registers the application to start with Windows', async () => {
  const ctx = loadMain();
  await ctx.start();
  assert.deepEqual(ctx.record.autoStart, [], 'app.setLoginItemSettings was never called');
  ctx.dispose();
});

// main.cjs keeps handles open under the fake Electron: end the process even when an assertion above fails.
test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });

test('B08-CFG the Store package is configured as a separate AppX build with its own identity and per-architecture file name', () => {
  const appx = pkg.build.appx;
  assert.equal(appx.applicationId, 'AECP');
  assert.equal(appx.identityName, 'Space653000.AECPPreview');
  assert.deepEqual(appx.languages, ['en-US', 'zh-TW']);
  assert.equal(appx.artifactName, 'AI-Engineering-Control-Plane-Store-${arch}-${version}.${ext}');
  assert.match(pkg.scripts['dist:store:x64'], /--win appx --x64/);
  assert.match(pkg.scripts['dist:store:arm64'], /--win appx --arm64/);
});

test('B08-CFG the GitHub Preview updater never selects a Store package, so the two channels cannot interfere', () => {
  const assets = [{ name: 'AI-Engineering-Control-Plane-Store-x64-2.0.0.appx' }, { name: 'AI-Engineering-Control-Plane-Store-arm64-2.0.0.appx' }, { name: 'AI-Engineering-Control-Plane-Setup-x64-2.0.0.exe' }];
  assert.equal(selectInstallerAsset(assets, '2.0.0', 'x64'), 'AI-Engineering-Control-Plane-Setup-x64-2.0.0.exe');
  assert.equal(selectInstallerAsset(assets.slice(0, 2), '2.0.0', 'x64'), null, 'with only Store packages in a release the updater installs nothing');
  assert.equal(selectInstallerAsset(assets.slice(0, 2), '2.0.0', 'arm64'), null);
});
