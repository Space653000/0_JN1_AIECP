'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fake = require('./support/update-channel-fake.cjs').install({ mode: 'tampered' });
const { loadMain } = require('./support/fake-electron-main.cjs');
const { createUi } = require('./support/ui-harness.cjs');
const { STATES, TRANSITIONS, createUpdateTransaction, transitionUpdate, reconcileFirstBoot } = require('../electron/lib/update-state.cjs');
const { selectInstallerAsset } = require('../electron/lib/version.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const SESSION = path.join(__dirname, 'support', 'main-session.cjs');
const netCalls = [];
const realFetch = global.fetch;
global.fetch = (input, ...rest) => { netCalls.push(String(input?.url || input)); return realFetch(input, ...rest); };
const updates = (...parts) => path.join(ctx.userData, 'updates', ...parts);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const snapshots = [];

test.before(async () => { await ctx.start(); });
test.after(() => {
  global.fetch = realFetch;
  fake.restore();
  for (const dir of snapshots) fs.rmSync(dir, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

function session(userData, action, { version, mode = 'good' } = {}) {
  const result = spawnSync(process.execPath, [SESSION, userData, '', action], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, AECP_FAKE_VERSION: version, AECP_FAKE_UPDATE_CHANNEL: mode } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('RESULT ')).slice(7));
}

test('B15-L40 an installer whose SHA-256 does not match the release manifest is never launched', async () => {
  fake.options.mode = 'tampered';
  await assert.rejects(() => H('update:apply'), /failed SHA-256 verification/);
  fake.options.mode = 'no-entry';
  await assert.rejects(() => H('update:apply'), /does not contain the selected installer/);
  assert.deepEqual(fake.record.spawned, [], 'nothing was executed');
  assert.equal(await H('update:status'), null, 'no update transaction was created for an unverified installer');
});

test('B15-L40 a renderer- or chat-supplied URL, branch or artifact cannot steer the update', async () => {
  fake.options.mode = 'good';
  const ghBefore = fake.record.gh.length;
  for (const payload of [{ url: 'https://evil.example/AECP-Setup.exe' }, { branch: 'main', tagName: 'v9.9.9' }, { assetName: 'evil.exe', repo: 'attacker/repo' }, { installer: 'C:/Windows/System32/cmd.exe' }]) {
    await assert.rejects(() => H('update:apply', payload), /Invalid IPC request/);
    await assert.rejects(() => H('update:check', payload), /Invalid IPC request/);
    await assert.rejects(() => H('update:rollback', payload), /Invalid IPC request/);
  }
  assert.equal(fake.record.gh.length, ghBefore, 'a rejected request reaches neither GitHub nor the disk');
  assert.deepEqual(fake.record.spawned, []);
  assert.deepEqual(netCalls, [], 'the update flow makes no request of its own; only the allowlisted gh channel is used');
});

test('B15-L40 nothing is downloaded or launched unless the release is newer than the running version', async () => {
  fake.options.mode = 'good';
  const latest = fake.options.latest;
  fake.options.latest = '0.0.0-test';
  try {
    assert.equal((await H('update:check')).available, false);
    const downloads = () => fake.record.gh.filter((args) => args[1] === 'download').length;
    const before = downloads();
    await assert.rejects(() => H('update:apply'), /No newer AECP Release/);
    assert.equal(downloads(), before);
    assert.deepEqual(fake.record.spawned, []);
  } finally { fake.options.latest = latest; }
});

test('B15-L291 the installer for this machine is chosen automatically: no architecture parameter, and the UI has no architecture control', async () => {
  fake.options.mode = 'good';
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  try {
    const chosen = {};
    for (const value of ['x64', 'arm64']) {
      Object.defineProperty(process, 'arch', { value, configurable: true });
      const result = await H('update:check');
      assert.equal(result.available, true);
      chosen[value] = result.assetName;
    }
    assert.equal(chosen.x64, 'AI-Engineering-Control-Plane-Setup-x64-9.9.9.exe');
    assert.equal(chosen.arm64, 'AI-Engineering-Control-Plane-Setup-arm64-9.9.9.exe');
  } finally { Object.defineProperty(process, 'arch', arch); }
  const assets = [{ name: 'AI-Engineering-Control-Plane-Setup-x64-2.0.0.exe' }, { name: 'AI-Engineering-Control-Plane-Setup-arm64-2.0.0.exe' }, { name: 'AI-Engineering-Control-Plane-Setup-2.0.0.exe' }];
  for (const value of ['x64', 'arm64', 'ia32', undefined]) assert.equal(selectInstallerAsset(assets, '2.0.0', value), 'AI-Engineering-Control-Plane-Setup-2.0.0.exe', 'the universal installer wins when the release has one');
  assert.equal(selectInstallerAsset(assets.slice(0, 2), '2.0.0', 'arm64'), 'AI-Engineering-Control-Plane-Setup-arm64-2.0.0.exe');
  assert.equal(selectInstallerAsset(assets.slice(0, 2), '2.0.0', 'ia32'), 'AI-Engineering-Control-Plane-Setup-x64-2.0.0.exe', 'an unknown architecture falls back to x64 rather than asking the user');
  assert.equal(selectInstallerAsset([{ name: 'AI-Engineering-Control-Plane-Setup-arm64-2.0.0.exe' }], '2.0.0', 'x64'), null, 'and never hands out an installer for the wrong architecture');

  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<(?:select|input|option)[^>]*(?:arch|x64|arm64)/i, 'no control asks the user to identify a CPU architecture');
  const ui = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
    checkUpdate: { connected: true, ghInstalled: true, available: true, currentVersion: '1.0.0', latestVersion: '2.0.0', message: 'A newer AECP Release is available.' }, applyUpdate: { ok: true }
  } });
  await ui.settle();
  await ui.el('#checkUpdateButton').click();
  await ui.settle();
  await ui.el('#applyUpdateButton').click();
  await ui.settle();
  const apply = ui.calls.find((call) => call.name === 'applyUpdate');
  assert.ok(apply, 'the ordinary update is one click');
  assert.deepEqual(apply.args, [], 'the UI passes nothing: not an architecture, URL or version');
});

test('B15-L40 a verified update comes only from the allowlisted release repository and never through a branch pull', async () => {
  fake.options.mode = 'good';
  fake.record.execFile.length = 0;
  fake.record.gh.length = 0;
  fake.record.ghRepos.clear();
  const checked = await H('update:check');
  assert.equal(checked.available, true);
  assert.equal(checked.latestVersion, '9.9.9');
  const applied = await H('update:apply');
  assert.equal(applied.ok, true);
  assert.equal(applied.rollbackPrepared, true);

  assert.deepEqual([...new Set(fake.record.execFile.map((call) => call.command))], ['gh'], 'the update flow runs no git command: no fetch, pull, clone or checkout');
  const subcommands = new Set(fake.record.gh.map((args) => (args[0] === '--version' || args[0] === 'auth' ? args[0] : `${args[0]} ${args[1]}`)));
  assert.deepEqual([...subcommands].sort(), ['--version', 'auth', 'release download', 'release list', 'release view']);
  assert.deepEqual([...fake.record.ghRepos], [fake.REPO], 'every release request names the one allowlisted repository');
  assert.ok(fake.record.gh.every((args) => !args.some((arg) => /^(?:pr|repo|api|clone|checkout|pull)$/.test(arg))));

  assert.equal(fake.record.spawned.length, 1, 'the installer was launched exactly once');
  const [launch] = fake.record.spawned;
  assert.deepEqual(launch.args, ['/S']);
  assert.equal(path.dirname(launch.command), updates('target', 'v9.9.9'), 'and it is the file AECP itself downloaded into its own updates folder');
  const transaction = await H('update:status');
  assert.equal(transaction.state, 'INSTALLING');
  assert.deepEqual(transaction.history.map((entry) => entry.state), ['VERIFIED', 'INSTALLING']);
  assert.equal(transaction.targetSha256, sha(launch.command), 'the launched bytes are exactly the bytes whose digest the manifest vouched for');
  assert.ok(fs.existsSync(transaction.rollbackInstaller) && sha(transaction.rollbackInstaller) === transaction.rollbackSha256, 'the previous version was retained and verified for rollback');
  assert.deepEqual(netCalls, []);
  for (const suffix of ['a', 'b', 'c']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aecp-update-${suffix}-`));
    fs.cpSync(ctx.userData, dir, { recursive: true });
    snapshots.push(dir);
  }
});

test('B15-L90 the required update states are all reachable in order and a first boot reports HEALTHY or ROLLBACK_REQUIRED', async () => {
  for (const state of ['DOWNLOADED', 'VERIFIED', 'INSTALLING', 'FIRST_BOOT_PENDING', 'HEALTHY', 'ROLLBACK_REQUIRED']) assert.ok(STATES.includes(state), state);
  assert.deepEqual([...TRANSITIONS.DOWNLOADED], ['VERIFIED', 'FAILED']);
  assert.deepEqual([...TRANSITIONS.VERIFIED], ['INSTALLING', 'FAILED'], 'nothing is installed before it was verified');
  assert.equal(TRANSITIONS.HEALTHY.size, 0);
  const fresh = createUpdateTransaction({ currentVersion: '1.0.0', targetVersion: '2.0.0', targetInstaller: 'i.exe', targetSha256: 'a'.repeat(64) });
  assert.throws(() => transitionUpdate(fresh, 'HEALTHY'), /Invalid update transition/);
  assert.throws(() => transitionUpdate(fresh, 'FIRST_BOOT_PENDING'), /Invalid update transition/);
  assert.throws(() => transitionUpdate(fresh, 'ROLLBACK_REQUIRED'), /Invalid update transition/);

  const [dirHealthy, dirRollback, dirTampered] = snapshots;
  const healthy = session(dirHealthy, 'update-status', { version: '9.9.9' });
  assert.equal(healthy.state, 'HEALTHY', 'first boot on the target version confirms the update');
  assert.deepEqual(healthy.history.map((entry) => entry.state), ['VERIFIED', 'INSTALLING', 'FIRST_BOOT_PENDING', 'HEALTHY']);

  const failed = session(dirRollback, 'update-status', { version: '0.0.0-test' });
  assert.equal(failed.state, 'ROLLBACK_REQUIRED', 'a first boot that is not the target version demands a rollback');
  assert.match(failed.reason, /did not match the verified update target/);
  assert.deepEqual(reconcileFirstBoot(failed, '9.9.9'), failed, 'a settled transaction is left alone');
  session(dirTampered, 'update-status', { version: '0.0.0-test' });

  const notRequired = session(dirHealthy, 'update-rollback', { version: '9.9.9' });
  assert.match(notRequired.error, /No rollback-required update/);
  assert.deepEqual(notRequired.spawned, []);

  const rollback = session(dirRollback, 'update-rollback', { version: '0.0.0-test' });
  assert.equal(rollback.result.ok, true);
  assert.equal(rollback.spawned.length, 1);
  assert.deepEqual(rollback.spawned[0].args, ['/S']);
  assert.ok(rollback.spawned[0].command.replace(/\\/g, '/').includes('/updates/rollback/v0.0.0-test/'));
  const rolledBack = session(dirRollback, 'update-status', { version: '0.0.0-test' });
  assert.equal(rolledBack.state, 'ROLLED_BACK', 'after the rollback installer ran, the next boot confirms the previous version is back');

  // The transaction records absolute paths, so the retained installer is the same file for every copy of the state.
  fs.appendFileSync(failed.rollbackInstaller, 'tampered');
  const refused = session(dirTampered, 'update-rollback', { version: '0.0.0-test' });
  assert.match(refused.error, /failed SHA-256 verification/, 'a retained rollback installer is re-verified before it runs');
  assert.deepEqual(refused.spawned, []);
});
