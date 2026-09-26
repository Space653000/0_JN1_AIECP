'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi } = require('./support/ui-harness.cjs');

const SNAPSHOT = {
  schema: 'aecp.control-plane/v1',
  runs: [{ id: 'mission-1', state: 'HUMAN_REQUIRED', goal: 'GOAL-TEXT-ALPHA', done: 'DONE-CRITERIA-BETA', sourceRoot: '/repo', createdAt: '2026-09-25T00:00:00Z', providers: { builder: 'x' } }],
  tasks: [{ id: 'task-1', runId: 'mission-1', title: 'Task one', objective: 'OBJECTIVE-TEXT', acceptance: 'ACCEPTANCE-TEXT', state: 'HUMAN_REQUIRED', risk: 'RED', attempts: 1, updatedAt: '2026-09-25T00:00:00Z', result: { tasks: [{ verification: { passed: true } }], patch: { changedFiles: ['a.txt'] } } }],
  agents: [], workers: [], locks: [],
  approvals: [{ id: 'ap-1', runId: 'mission-1', taskId: 'task-1', state: 'WAITING', reason: 'APPROVAL-REASON', risk: 'RED', createdAt: '2026-09-25T00:00:00Z' }]
};
const EVENTS = [{ id: 'evt-1', at: '2026-09-25T00:00:00Z', type: 'task.claimed', runId: 'mission-1', taskId: 'task-1', evidence: { file: '/evidence/task-1/evidence.json', sha256: 'abc123' } }];

async function boot(snapshot = SNAPSHOT, events = EVENTS) {
  const ui = createUi({ files: ['i18n.js', 'dashboard-projection.js', 'harness-console.js'], responses: { getControlPlaneStatus: snapshot, getControlPlaneEvents: events, listRemoteDevices: [] } });
  ui.document.body.dataset.aecpCommand = '1';
  await ui.callbacks.onControlPlaneEvent[0]();
  await ui.settle();
  return ui;
}

test('R8.4 the Command Center shows the mission goal, the current state, the risk and the approval a person must give', async () => {
  const html = (await boot()).el('#controlContent').innerHTML;
  assert.ok(html.includes('GOAL-TEXT-ALPHA'), 'goal');
  assert.match(html, /<span class="status warn">HUMAN_REQUIRED<\/span>/, 'current state, with the attention colour');
  assert.ok(html.includes('APPROVAL-REASON') && html.includes('Risk RED'), 'the approval and its risk');
  assert.match(html, /Needs me: YES · APPROVAL-REASON/, 'the task says a person is needed and why');
  assert.match(html, /Verifier\/Test: PASS/);
  assert.match(html, /Changed: a\.txt/);
  assert.match(html, /data-approve="ap-1"[^>]*>Approve<\/button><button data-reject="ap-1"/, 'approve and reject are offered for the waiting approval');
});

test('R8.4 evidence of a task is reachable from its timeline, and unknown values are shown as UNKNOWN rather than invented', async () => {
  const ui = await boot();
  const button = { dataset: { eventId: 'evt-1' }, onclick: null };
  ui.document.lists['[data-event-id]'] = [button];
  await ui.callbacks.onControlPlaneEvent[0]();
  await ui.settle();
  assert.equal(typeof button.onclick, 'function', 'the timeline event is a real control');
  button.onclick();
  const html = ui.el('#controlContent').innerHTML;
  assert.ok(html.includes('/evidence/task-1/evidence.json') && html.includes('abc123'), 'selecting the event shows its evidence path and hash');

  const bare = await boot({ ...SNAPSHOT, tasks: [{ id: 'task-2', runId: 'mission-1', title: 'No data', state: 'RUNNING' }], approvals: [] }, []);
  const bareHtml = bare.el('#controlContent').innerHTML;
  assert.match(bareHtml, /Verifier\/Test: UNKNOWN/);
  assert.match(bareHtml, /Changed: UNKNOWN/);
  assert.match(bareHtml, /Needs me: NO/);
});
