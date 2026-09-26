'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-corrupt-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-corrupt-ws-'));
const CORRUPT = { 'workers/worker-registry.json': '{ "schema": "aecp.worker-registry/v1", "workers": {', 'runtime/control-plane.json': 'not json at all \u0000', 'runtime/locks/locks.json': '{{{', 'runtime/resources/resources.json': '[1,2' };
for (const [file, bytes] of Object.entries(CORRUPT)) {
  fs.mkdirSync(path.dirname(path.join(userData, file)), { recursive: true });
  fs.writeFileSync(path.join(userData, file), bytes);
}
execFileSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'README.md'), 'safe bridge\n');
const ctx = loadMain({ userData });
const H = (channel, payload) => ctx.handlers[channel]({}, payload);

test.after(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('G16 corrupted optional state files never stop the app: they are set aside, reported, and the Web Safe Bridge works', async () => {
  await ctx.start();
  assert.equal(typeof ctx.handlers['task:import'], 'function', 'IPC was registered');
  for (const [file, bytes] of Object.entries(CORRUPT)) {
    const dir = path.dirname(path.join(userData, file));
    const kept = fs.readdirSync(dir).filter((name) => name.startsWith(`${path.basename(file)}.corrupt-`));
    assert.equal(kept.length, 1, `${file} was renamed, not deleted`);
    assert.equal(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), bytes, 'and its bytes are preserved for diagnosis');
  }
  const info = await H('app:info');
  assert.ok(Array.isArray(info.startupWarnings) && info.startupWarnings.length >= 1, 'the UI is told');
  assert.ok(info.startupWarnings.some((warning) => /worker-registry\.json/.test(warning.file) && /corrupt/.test(warning.kind)));
  assert.ok(info.startupWarnings.every((warning) => typeof warning.quarantinedAs === 'string' && !warning.quarantinedAs.includes(userData)), 'warnings carry names, not local paths');

  ctx.control.chosenFolder = workspace;
  await H('workspace:select');
  const card = await H('task:sample');
  const task = await H('task:import', { text: JSON.stringify(card) });
  const result = await H('task:execute', { taskId: task.id });
  assert.equal(result.ok, true);
  assert.equal(await H('chatgpt:open'), true);

  const status = await H('control-plane:status');
  assert.deepEqual([status.runs.length, status.tasks.length], [0, 0], 'the Control Plane restarted from an empty state');
  const events = await H('control-plane:events', { limit: 50 });
  assert.ok(events.some((event) => event.type === 'maintenance.failed' && Array.isArray(event.quarantined) && event.quarantined.length >= 1), 'and journaled why');
  assert.ok(fs.existsSync(path.join(userData, 'workers', 'worker-registry.json')), 'a fresh registry was created');
});
