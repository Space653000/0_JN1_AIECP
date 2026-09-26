'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { CodexWorkerRuntime } = require('../electron/lib/codex-worker-runtime.cjs');
const { makeBase, removeDir } = require('./support/e2e-fixtures.cjs');

// Windows briefly locks a file that another process (Codex, an antivirus scan) has open, so renaming the
// new config over it fails with EPERM/EBUSY/EACCES. That used to surface as a failed provider list.

function failRename(times, code) {
  const real = fsp.rename;
  let calls = 0;
  fsp.rename = async (from, to) => {
    calls += 1;
    if (calls <= times) throw Object.assign(new Error(code + ': simulated lock'), { code });
    return real(from, to);
  };
  return { restore() { fsp.rename = real; }, calls() { return calls; } };
}

async function leftovers(dir) {
  return (await fsp.readdir(dir)).filter((name) => /\.tmp-\d+-[0-9a-f]+$/.test(name));
}

test('a transient EPERM/EBUSY/EACCES lock on config.toml is retried and the config is still written', async (t) => {
  const base = await makeBase('aecp-cfg-lock-');
  t.after(async () => removeDir(base));
  const runtime = new CodexWorkerRuntime(path.join(base, 'codex-workers'));
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    const sim = failRename(2, code);
    try {
      const profile = await runtime.prepareOfficial({ model: 'm-' + code });
      assert.match(await fsp.readFile(path.join(profile.codexHome, 'config.toml'), 'utf8'), new RegExp('model = "m-' + code + '"'));
      assert.equal(sim.calls(), 3);
      assert.deepEqual(await leftovers(profile.codexHome), []);
    } finally { sim.restore(); }
  }
});

test('a lock that never clears fails after a bounded number of attempts and leaves no scratch file', async (t) => {
  const base = await makeBase('aecp-cfg-lock-');
  t.after(async () => removeDir(base));
  const runtime = new CodexWorkerRuntime(path.join(base, 'codex-workers'));
  const sim = failRename(1000, 'EPERM');
  try {
    await assert.rejects(runtime.prepareOfficial({ model: 'm' }), { code: 'EPERM' });
    assert.ok(sim.calls() >= 3 && sim.calls() <= 12, 'attempts are bounded, got ' + sim.calls());
  } finally { sim.restore(); }
  assert.deepEqual(await leftovers(runtime.codexHome('codex-official')), []);
});

test('an error that is not a lock is not retried', async (t) => {
  const base = await makeBase('aecp-cfg-lock-');
  t.after(async () => removeDir(base));
  const runtime = new CodexWorkerRuntime(path.join(base, 'codex-workers'));
  const sim = failRename(1000, 'ENOSPC');
  try {
    await assert.rejects(runtime.prepareOfficial({ model: 'm' }), { code: 'ENOSPC' });
    assert.equal(sim.calls(), 1);
  } finally { sim.restore(); }
});
