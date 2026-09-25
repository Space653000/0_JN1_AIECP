'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SESSION = path.join(__dirname, 'support', 'main-session.cjs');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-trace-ud-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-trace-ws-'));
execFileSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'a.txt'), 'trace\n');
test.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(workspace, { recursive: true, force: true }); });

// Every call is a brand-new process running the real main.cjs: a genuine application restart.
function session(action, taskId = '') {
  const result = spawnSync(process.execPath, [SESSION, userData, workspace, action, taskId], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('RESULT ')).slice(7));
}
const traceFile = (id) => path.join(userData, 'evidence', id, 'trace.jsonl');
const readTrace = (id) => fs.readFileSync(traceFile(id), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('B11-6-TRACE every trace event has the aecp.trace/v1 shape, a gap-free sequence, and the sequence continues across an application restart', () => {
  const id = session('import');
  assert.deepEqual(readTrace(id).map((event) => [event.seq, event.type]), [[1, 'task.imported']]);
  const restarted = session('execute', id);
  assert.equal(restarted.ok, true);
  const events = readTrace(id);
  assert.deepEqual(events.map((event) => event.type), ['task.imported', 'execution.started', 'verification.completed', 'task.completed']);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4], 'the second process continued the first process\'s sequence instead of restarting at 1');
  for (const event of events) {
    assert.deepEqual(Object.keys(event), ['schema', 'taskId', 'seq', 'at', 'type', 'severity', 'data']);
    assert.equal(event.schema, 'aecp.trace/v1');
    assert.equal(event.taskId, id);
    assert.equal(event.severity, 'info');
    assert.ok(!Number.isNaN(Date.parse(event.at)) && event.at.endsWith('Z'));
    assert.equal(typeof event.data, 'object');
  }
  assert.ok(events.every((event, index) => index === 0 || Date.parse(event.at) >= Date.parse(events[index - 1].at)), 'timestamps never go backwards');
  assert.equal(events[0].data.risk, 'GREEN');
  assert.match(events[0].data.cardHash, /^[0-9a-f]{64}$/);
  assert.equal(events[1].data.adapter, 'git-status');
  assert.match(events[3].data.resultHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(session('trace', id), events, 'a third process reads back exactly what was persisted');
});

test('B11-6-TRACE a failed task records an error-severity event and a re-run after restart keeps appending in order', () => {
  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-trace-nonrepo-'));
  try {
    const id = session('import-git-status');
    fs.writeFileSync(path.join(nonRepo, 'x'), 'x');
    // Make the Workspace root stop being a Git repository so the fixed git-status adapter fails.
    fs.renameSync(path.join(workspace, '.git'), path.join(nonRepo, '.git-moved'));
    try {
      const failed = session('execute', id);
      assert.equal(failed.ok, false);
      const events = readTrace(id);
      assert.deepEqual(events.map((event) => event.type), ['task.imported', 'execution.started', 'task.failed']);
      assert.equal(events.at(-1).severity, 'error');
      assert.match(events.at(-1).data.message, /not a Git repository/);
      const before = events.length;
      const again = session('execute', id);
      assert.equal(again.ok, false);
      assert.deepEqual(readTrace(id).map((event) => event.seq), Array.from({ length: before + 2 }, (_, index) => index + 1), 'a retry in a new process appends with the next sequence numbers');
    } finally {
      fs.renameSync(path.join(nonRepo, '.git-moved'), path.join(workspace, '.git'));
    }
  } finally { fs.rmSync(nonRepo, { recursive: true, force: true }); }
});
