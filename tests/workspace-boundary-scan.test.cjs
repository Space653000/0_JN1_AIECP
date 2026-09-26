'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Record every directory listing and every process working directory while the real code runs.
const listed = [];
const cwds = [];
const realExecFile = cp.execFile;
const realSpawn = cp.spawn;
const realReaddir = fsp.readdir;
const note = (list, value) => { if (value) list.push(path.resolve(String(value))); };
cp.execFile = function execFile(command, args, options, ...rest) { note(cwds, options && options.cwd); return realExecFile.call(this, command, args, options, ...rest); };
cp.spawn = function spawn(command, args, options, ...rest) { note(cwds, options && options.cwd); return realSpawn.call(this, command, args, options, ...rest); };
fsp.readdir = function readdir(target, ...rest) { note(listed, target); return realReaddir.call(this, target, ...rest); };
const { loadMain } = require('./support/fake-electron-main.cjs');
const { ResourceManager } = require('../electron/lib/resource-manager.cjs');
cp.execFile = realExecFile;
cp.spawn = realSpawn;

const ctx = loadMain();
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-boundary-')));
const workspace = path.join(base, 'workspace');
const sibling = path.join(base, 'sibling-project');
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const gitRepo = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), path.basename(dir));
};

test.before(async () => {
  for (const name of ['repoA', 'repoB', '.hidden-repo', path.join('notes', 'inner', 'deep-repo')]) gitRepo(path.join(workspace, name));
  gitRepo(sibling);
  fs.mkdirSync(path.join(base, 'unrelated-folder', 'private'), { recursive: true });
  await ctx.start();
});
test.after(() => {
  fsp.readdir = realReaddir;
  fs.rmSync(base, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('B14-L88 with no Workspace chosen nothing on the disk is listed or scanned, however much onboarding state is requested', async () => {
  listed.length = 0; cwds.length = 0;
  assert.equal((await H('guidance:recommend', {})).action, 'CHOOSE_WORKSPACE');
  assert.equal((await H('state:get')).currentWorkspace, null);
  assert.equal((await H('task:list')).length, 0);
  ctx.control.chosenFolder = null;
  assert.equal(await H('workspace:select'), null, 'a cancelled folder dialog picks nothing');
  const userData = fs.realpathSync(ctx.userData);
  const outsideAecp = [...listed, ...cwds].filter((entry) => !inside(userData, entry));
  assert.deepEqual(outsideAecp, [], 'AECP must not enumerate the disk to guess which folders the user meant');
});

test('B14-L88 an explicitly chosen Workspace is scanned only inside its own boundary and only one level deep', async () => {
  listed.length = 0; cwds.length = 0;
  ctx.control.chosenFolder = workspace;
  const chosen = await H('workspace:select');
  assert.equal(chosen.rootPath, workspace);
  assert.deepEqual(chosen.repositories.map((repo) => repo.name).sort(), ['repoA', 'repoB'], 'root and direct children only: no hidden folder, no depth-2 repo, no sibling project');
  await H('workspace:refresh');
  const scanned = new Set([...listed, ...cwds].filter((entry) => !inside(fs.realpathSync(ctx.userData), entry)));
  assert.ok([...scanned].length > 0, 'the Workspace itself really was scanned');
  for (const entry of scanned) assert.ok(inside(workspace, entry), `${entry} is outside the chosen Workspace`);
  for (const forbidden of [sibling, path.join(base, 'unrelated-folder'), path.join(workspace, 'notes')]) {
    assert.ok(![...scanned].some((entry) => inside(forbidden, entry)), `${forbidden} must not be scanned`);
  }
  assert.ok(![...listed, ...cwds].some((entry) => entry === base || entry === path.dirname(base)), 'the parent folder of the Workspace is never listed or used as a working directory');
});

test('B14-L88 adding a repository is an explicit choice that cannot reach outside the Workspace', async () => {
  ctx.control.chosenFolder = sibling;
  await assert.rejects(() => H('workspace:add-repo'), /outside|within|Workspace/i);
  assert.deepEqual((await H('state:get')).currentWorkspace.repositories.map((repo) => repo.name).sort(), ['repoA', 'repoB']);
  ctx.control.chosenFolder = path.join(workspace, 'notes', 'inner', 'deep-repo');
  const added = await H('workspace:add-repo');
  assert.ok(added.repositories.some((repo) => repo.name === 'deep-repo'), 'a deep repository inside the Workspace can be added, but only by an explicit action');
});

test('B14-L88 the Mission resource scan (ResourceManager) also stays inside the approved root and one level deep', async () => {
  const stateDir = fs.mkdtempSync(path.join(base, 'resources-'));
  const manager = new ResourceManager(stateDir);
  await manager.init();
  listed.length = 0; cwds.length = 0;
  const repos = await manager.scan(workspace);
  assert.deepEqual(repos.map((repo) => path.basename(repo.path)).sort(), ['repoA', 'repoB'], 'direct child repositories only');
  const touched = [...listed, ...cwds].filter((entry) => !inside(stateDir, entry));
  for (const entry of touched) assert.ok(inside(workspace, entry), `${entry} is outside the approved root`);
  assert.ok(touched.length > 0);
  assert.ok(!listed.includes(base) && !listed.includes(path.dirname(workspace)));
});
