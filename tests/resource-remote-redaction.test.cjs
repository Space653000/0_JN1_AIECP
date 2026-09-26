'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ResourceManager } = require('../electron/lib/resource-manager.cjs');

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

async function scanWithRemote(t, remote) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-remote-'));
  t.after(async () => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repo = path.join(base, 'repo');
  await fs.mkdir(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  const manager = new ResourceManager(path.join(base, 'state'));
  await manager.init();
  const repos = await manager.scan(base);
  return { repos, file: await fs.readFile(path.join(base, 'state', 'resources.json'), 'utf8'), memory: JSON.stringify(manager.state) };
}

test('G11-3 a remote with embedded user:token credentials is stored without them but stays identifiable', async (t) => {
  const { repos, file, memory } = await scanWithRemote(t, `https://alice:${TOKEN}@github.com/o/r.git`);
  for (const text of [file, memory, JSON.stringify(repos)]) {
    assert.ok(!text.includes(TOKEN) && !text.includes('alice:') && !text.includes('alice@'), 'no credential anywhere');
  }
  assert.match(repos[0].remote, /github\.com\/o\/r\.git$/, 'host and path remain for identification');
});

test('G11-3 a token-only userinfo and a plain remote are handled too', async (t) => {
  const tokenOnly = await scanWithRemote(t, `https://${TOKEN}@github.com/o/r.git`);
  assert.ok(!tokenOnly.file.includes(TOKEN));
  assert.match(tokenOnly.repos[0].remote, /github\.com\/o\/r\.git$/);
  const plain = await scanWithRemote(t, 'https://github.com/o/plain.git');
  assert.equal(plain.repos[0].remote, 'https://github.com/o/plain.git');
});
