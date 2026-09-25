'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { sha256 } = require('../electron/lib/evidence-manager.cjs');
const { makeBase, makeRepo, makeRouter, removeDir, waitFor, git } = require('./support/e2e-fixtures.cjs');

const CHILD = path.join(__dirname, 'support', 'crash-child.cjs');
test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });

function startChild(base) {
  const child = spawn(process.execPath, [CHILD, base], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited, output: () => out, errors: () => err };
}

test('B14-L419 after a process is killed in the middle of a Goal Loop, a new process reconstructs loop, task and evidence from local state and finishes the work after an explicit resume', async (t) => {
  const base = await makeBase('aecp-crash-');
  t.after(async () => removeDir(base));
  const workspace = await makeRepo(path.join(base, 'workspace'));
  const head = await git(workspace, 'rev-parse', 'HEAD');
  const first = startChild(base);
  t.after(() => { try { first.child.kill('SIGKILL'); } catch { /* already dead */ } });
  await waitFor(() => first.output().includes('BUILDER_STARTED') || first.errors(), { timeoutMs: 60000, label: 'the child builder to start' });
  assert.equal(first.errors(), '', first.errors());
  const { runId, taskId } = JSON.parse(first.output().split('\n').find((line) => line.startsWith('IDS ')).slice(4));
  const rootDir = path.join(base, 'runtime');
  const disk = async () => JSON.parse(await fs.readFile(path.join(rootDir, 'control-plane.json'), 'utf8'));
  await waitFor(async () => (await disk()).tasks[taskId]?.state === 'RUNNING', { label: 'the running task to reach the disk' });
  const journalBefore = (await fs.readFile(path.join(rootDir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line).id);
  assert.ok(journalBefore.length >= 3);
  const harnessFile = path.join(rootDir, 'runs', runId, taskId, 'harness.json');
  await waitFor(() => fs.readFile(harnessFile, 'utf8').then((text) => JSON.parse(text).state === 'RUNNING', () => false), { label: 'the Goal Loop record to be written' });
  const harnessBefore = JSON.parse(await fs.readFile(harnessFile, 'utf8'));

  first.child.kill('SIGKILL');
  const exit = await first.exited;
  assert.ok(exit.signal === 'SIGKILL' || exit.code !== 0, 'the process really died without a clean shutdown');

  const calls = [];
  const cp = new ControlPlane({ rootDir, providerRouter: makeRouter({ calls }) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));

  const run = cp.state.runs[runId];
  const task = cp.state.tasks[taskId];
  assert.equal(run.state, 'PAUSED', 'the mission is recovered as paused, not guessed to be running or finished');
  assert.equal(run.recovery.reason, 'process-restart');
  assert.equal(run.recovery.requiresExplicitResume, true);
  assert.equal(task.state, 'QUEUED');
  assert.equal(task.phase, 'RECOVERED');
  assert.equal(task.resume, true);
  assert.equal(task.lease, null, 'the dead process lease was cleared');
  assert.deepEqual((await cp.listEvents(5000)).map((event) => event.id).slice(0, journalBefore.length), journalBefore, 'the event journal written before the crash is intact');
  assert.equal(JSON.parse(await fs.readFile(harnessFile, 'utf8')).id, harnessBefore.id, 'the Goal Loop record on disk is the one the crashed process wrote');
  assert.equal((await fs.readFile(path.join(cp.evidence.root, runId, 'events.jsonl'), 'utf8')).length > 0, true, 'the evidence event stream survived');
  assert.equal(await git(workspace, 'status', '--porcelain'), '', 'the crash left the source Workspace untouched');
  assert.equal(await git(workspace, 'rev-parse', 'HEAD'), head);
  await cp.schedulerTick();
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(calls.filter((call) => call.role === 'builder').length, 0, 'nothing is replayed until a human resumes the mission');

  await cp.startMission(runId);
  await waitFor(() => cp.state.tasks[taskId].state === 'DONE' && cp.state.runs[runId].state === 'DONE', { timeoutMs: 60000, label: 'the resumed mission to finish' });
  assert.equal(calls.filter((call) => call.role === 'builder').length, 1, 'the resumed task ran exactly once');
  const finished = cp.state.tasks[taskId];
  assert.equal(JSON.parse(await fs.readFile(harnessFile, 'utf8')).id, harnessBefore.id, 'resuming continued the same Goal Loop record instead of starting a new one');
  const manifest = await cp.evidence.verifyManifest(finished.evidenceManifest);
  assert.equal(manifest.ok, true, manifest.reason);
  assert.match(await sha256(finished.evidence.file), /^[0-9a-f]{64}$/);
  assert.deepEqual((await cp.listEvents(5000)).map((event) => event.id).slice(0, journalBefore.length), journalBefore);
});
