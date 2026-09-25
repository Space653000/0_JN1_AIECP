'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi } = require('./support/ui-harness.cjs');
const { recommendNextAction } = require('../electron/lib/guidance.cjs');

const WORKSPACE = { id: 'ws-1', name: 'Demo', rootPath: '/demo', repositories: [], policy: { maxRisk: 'YELLOW' } };
const READ_ONLY_CALL = /^(get|list|detect)[A-Z]/;

async function boot(responses = {}) {
  const ui = createUi({ responses: { getState: { currentWorkspace: WORKSPACE, providers: [] }, listTasks: [], ...responses } });
  await ui.settle();
  return ui;
}

test('B01-L67 switching between Beginner and Engineering mode changes only the projection, never a permission or any stored state', async () => {
  const ui = await boot({ getPolicy: { maxRisk: 'YELLOW' } });
  const snapshot = () => JSON.stringify({ data: ui.evaluate('state.data'), providers: ui.evaluate('state.providers'), tasks: ui.evaluate('state.tasks'), policy: ui.evaluate('state.policyInfo'), view: ui.evaluate('state.view') });
  const stateBefore = snapshot();
  const callsBefore = ui.calls.length;
  assert.equal(ui.evaluate('state.engineering'), false);
  assert.equal(ui.document.body.classList.contains('engineering-mode'), false);

  for (const expected of [true, false, true]) {
    await ui.el('#modeButton').click();
    await ui.settle();
    assert.equal(ui.evaluate('state.engineering'), expected);
    assert.equal(ui.document.body.classList.contains('engineering-mode'), expected, 'the mode is only a body class the CSS reads');
  }
  assert.deepEqual(ui.calls.slice(callsBefore), [], 'toggling the mode must not call a single main-process API (no policy, approval, provider or workspace change)');
  assert.deepEqual(ui.prompts, [], 'toggling the mode must not ask for or grant any confirmation');
  assert.equal(snapshot(), stateBefore, 'workspace, provider, task and policy state are identical in both modes');
});

test('B01-L67 leaving Engineering mode while on an engineering-only view returns to Start without touching permissions', async () => {
  const ui = await boot();
  await ui.el('#modeButton').click();
  ui.evaluate("state.view = 'trace'");
  const callsBefore = ui.calls.length;
  await ui.el('#modeButton').click();
  assert.equal(ui.evaluate('state.view'), 'start');
  assert.equal(ui.evaluate('state.engineering'), false);
  assert.deepEqual(ui.calls.slice(callsBefore), []);
});

test('B14-L15 everything the UI detects on its own is read-only: opening the app performs only get/list/detect calls', async () => {
  const ui = await boot({ getGuidance: { action: 'RUN_TASK', label: 'Run ready task', taskId: 'TASK-1' } });
  assert.ok(ui.calls.length >= 10, 'the UI really detected the environment on start');
  const offenders = ui.calls.filter((call) => !READ_ONLY_CALL.test(call.name)).map((call) => call.name);
  assert.deepEqual(offenders, [], 'no automatic mutating call may happen at start-up, even when guidance recommends an action');
  assert.deepEqual(ui.prompts, []);
});

test('B14-L15 a recommended action only navigates or waits for an explicit click: approval guidance never approves anything', async () => {
  const ui = await boot({ getGuidance: { action: 'REVIEW_APPROVAL', label: 'Review approval', detail: 'waiting', taskId: 'TASK-9' } });
  const html = ui.el('#controlContent').innerHTML;
  assert.match(html, /class="primary-button" data-action="show-loop" data-task-id="TASK-9"/, 'approval guidance points at the Goal Loop view, not at an approve action');
  assert.doesNotMatch(html, /data-action="(?:approve|run-task|apply-autonomy|start-autonomy)"[^>]*>Review approval/);
  const callsBefore = ui.calls.length;
  const click = ui.document.listeners.click[0];
  await click({ target: { closest: (selector) => (selector === '[data-action]' ? { dataset: { action: 'show-loop' } } : null) } });
  await ui.settle();
  assert.deepEqual(ui.calls.slice(callsBefore).filter((call) => !READ_ONLY_CALL.test(call.name)), []);
});

test('B14-L15 guidance detects the next safe step but keeps Workspace choice, approvals and Goal creation explicit', () => {
  assert.equal(recommendNextAction({ hasWorkspace: false, tasks: [{ id: 'T', state: 'READY' }] }).action, 'CHOOSE_WORKSPACE', 'no data access is assumed before the user picks a Workspace');
  const waiting = recommendNextAction({ hasWorkspace: true, tasks: [{ id: 'T1', state: 'READY' }], approvals: [{ state: 'WAITING', taskId: 'T2' }] });
  assert.equal(waiting.action, 'REVIEW_APPROVAL', 'a pending approval outranks running a ready task');
  assert.equal(waiting.taskId, 'T2');
  const human = recommendNextAction({ hasWorkspace: true, tasks: [{ id: 'T3', state: 'HUMAN_REQUIRED' }, { id: 'T4', state: 'READY' }] });
  assert.equal(human.action, 'REVIEW_APPROVAL');
  assert.equal(recommendNextAction({ hasWorkspace: true, tasks: [{ id: 'T5', state: 'READY' }], harnessState: 'RUNNING' }).action, 'WATCH_ACTIVE_WORK');
  assert.equal(recommendNextAction({ hasWorkspace: true, tasks: [{ id: 'T6', state: 'READY' }], chatgptOpened: false }).action, 'RUN_TASK');
  assert.equal(recommendNextAction({ hasWorkspace: true, tasks: [{ id: 'T7', state: 'FAILED' }], chatgptOpened: true }).action, 'CREATE_GOAL');
  for (const input of [{}, { hasWorkspace: true }, { hasWorkspace: true, tasks: [{ id: 'T8', state: 'DONE' }] }]) {
    const action = recommendNextAction(input).action;
    assert.ok(!/APPROVE|MERGE|PUSH|APPLY|GRANT/.test(action), `${action} must not itself change permissions or blast radius`);
  }
});
