'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const childProcess = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const spawned = [];
let recording = false;
const realSpawn = childProcess.spawn;
childProcess.spawn = function recordingSpawn(command, ...rest) {
  if (recording) spawned.push(command);
  return realSpawn.call(this, command, ...rest);
};
const resourceManagerPath = require.resolve('../electron/lib/resource-manager.cjs');
delete require.cache[resourceManagerPath];
const { ResourceManager } = require(resourceManagerPath);
childProcess.spawn = realSpawn;

function git(cwd, ...args) {
  childProcess.execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function makeRepo(parent, name, remote) {
  const dir = path.join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init', '-q');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

async function makeRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-binding-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('B05-L5 a Workspace can bind zero repositories using only local Git', async (t) => {
  const root = await makeRoot(t);
  await fs.mkdir(path.join(root, 'plain-folder'));
  const manager = new ResourceManager(path.join(root, '.resources'));
  await manager.init();
  recording = true;
  const repos = await manager.scan(root);
  recording = false;
  assert.deepEqual(repos, []);
  assert.deepEqual(manager.state.workspaces[path.resolve(root)].repositories, []);
  assert.ok(spawned.every((command) => command === 'git'), `only git may run, saw ${[...new Set(spawned)]}`);
});

test('B05-L5 a Workspace can bind one or many repositories with different remotes/accounts and no GitHub authentication', async (t) => {
  const root = await makeRoot(t);
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  await makeRepo(workspace, 'repo-one', 'https://github.com/acme/one.git');
  await makeRepo(workspace, 'repo-two', 'git@github.com:other-account/two.git');
  await makeRepo(workspace, 'repo-local-only', null);
  await fs.mkdir(path.join(workspace, 'not-a-repo'));

  const manager = new ResourceManager(path.join(root, '.resources'));
  await manager.init();
  spawned.length = 0;
  recording = true;
  const repos = await manager.scan(workspace);
  recording = false;

  assert.equal(repos.length, 3);
  const byName = Object.fromEntries(repos.map((repo) => [path.basename(repo.path), repo]));
  assert.equal(byName['repo-one'].remote, 'https://github.com/acme/one.git');
  assert.equal(byName['repo-two'].remote, 'git@github.com:other-account/two.git');
  assert.equal(byName['repo-local-only'].remote, '');
  assert.equal(new Set(repos.map((repo) => repo.id)).size, 3);
  assert.ok(repos.every((repo) => repo.branch.length > 0));
  assert.ok(spawned.length > 0 && spawned.every((command) => command === 'git'), 'no gh or network authentication command may be needed');

  const reloaded = new ResourceManager(path.join(root, '.resources'));
  await reloaded.init();
  assert.deepEqual(Object.keys(reloaded.state.repositories).sort(), repos.map((repo) => repo.id).sort());
  assert.equal(reloaded.state.workspaces[path.resolve(workspace)].repositories.length, 3);
});

test('B05-L5 a Workspace root that is itself a repository binds exactly that repository once', async (t) => {
  const root = await makeRoot(t);
  const repo = await makeRepo(root, 'single', 'https://github.com/acme/single.git');
  const manager = new ResourceManager(path.join(root, '.resources'));
  await manager.init();
  const repos = await manager.scan(repo);
  assert.equal(repos.length, 1);
  assert.equal(path.resolve(repos[0].path).toLowerCase(), path.resolve(repo).toLowerCase());
});
