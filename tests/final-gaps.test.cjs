'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { createUi } = require('./support/ui-harness.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-final-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-final-ws-'));
execFileSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'README.md'), 'final gaps\n');
const ctx = loadMain({ userData });
const H = (channel, payload) => ctx.handlers[channel]({}, payload);

test.after(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('B12-L134 every persisted task document carries a versioned schema identifier', async () => {
  await ctx.start();
  ctx.control.chosenFolder = workspace;
  await H('workspace:select');
  const card = await H('task:sample');
  const task = await H('task:import', { text: JSON.stringify(card) });
  const result = await H('task:execute', { taskId: task.id });
  assert.equal(result.ok, true);
  const dir = path.join(userData, 'evidence', task.id);
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.equal(read('task.json').schema, 'aecp.task-record/v1');
  assert.equal(read('evidence.json').schema, 'aecp.task-evidence/v1');
  assert.equal(read('result.json').schema, 'aecp.result/v1');
  assert.equal(read('task.json').id, task.id, 'the task content is unchanged apart from the identifier');
  const evidence = await H('task:evidence', { taskId: task.id });
  assert.equal(evidence.task.schema, 'aecp.task-record/v1');
});

const SNAPSHOT = {
  schema: 'aecp.control-plane/v1',
  runs: [{ id: 'mission-1', state: 'RUNNING', goal: 'GOAL-ALPHA', done: 'DOD-BETA acceptance', sourceRoot: '/repo', createdAt: '2026-09-25T00:00:00Z' },
    { id: 'mission-2', state: 'QUEUED', goal: 'GOAL-NO-DOD', sourceRoot: '/repo', createdAt: '2026-09-25T00:00:00Z' }],
  tasks: [{ id: 'task-1', runId: 'mission-1', title: 'Risky task', objective: 'o', state: 'RUNNING', risk: 'RED', updatedAt: '2026-09-25T00:00:00Z' },
    { id: 'task-2', runId: 'mission-1', title: 'Unrated task', objective: 'o', state: 'QUEUED', updatedAt: '2026-09-25T00:00:00Z' }],
  agents: [], workers: [], locks: [], approvals: []
};

async function bootConsole() {
  const ui = createUi({ files: ['i18n.js', 'dashboard-projection.js', 'harness-console.js'], responses: { getControlPlaneStatus: SNAPSHOT, getControlPlaneEvents: [], listRemoteDevices: [] } });
  ui.document.body.dataset.aecpCommand = '1';
  await ui.callbacks.onControlPlaneEvent[0]();
  await ui.settle();
  return ui.el('#controlContent').innerHTML;
}

test('R8.4 the Command Center shows each mission Definition of Done and each task risk, and UNKNOWN when missing', async () => {
  const html = await bootConsole();
  assert.ok(html.includes('Definition of Done: DOD-BETA acceptance'), 'the mission row shows its Definition of Done');
  assert.ok(html.includes('Definition of Done: UNKNOWN'), 'a mission without one says UNKNOWN instead of hiding it');
  assert.ok(html.includes('<small>Risk: RED</small>'), 'the task card shows its risk');
  assert.ok(html.includes('<small>Risk: UNKNOWN</small>'), 'an unrated task says UNKNOWN');
});

const dockUi = (windows) => createUi({ responses: {
  getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
  listBrowserWindows: windows, dockBrowserWindow: { ok: true }
} });

test('B06-L31 the dock controls teach Windows Snap and the last chosen dock side is remembered', async () => {
  const fresh = dockUi([{ process: 'chrome', pid: 4242, handle: 1 }]);
  await fresh.settle();
  assert.equal(fresh.el('#dockBrowserLeftButton').getAttribute('aria-pressed'), 'false');
  assert.equal(fresh.el('#dockBrowserRightButton').getAttribute('aria-pressed'), 'false');
  await fresh.el('#browserWindowSelect').fire('change');
  fresh.el('#browserWindowSelect').value = '4242';
  await fresh.el('#dockBrowserRightButton').click();
  await fresh.settle();
  assert.equal(fresh.context.localStorage.getItem('aecp-dock-side'), 'right', 'the choice is stored locally');

  const returning = dockUi([{ process: 'chrome', pid: 4242, handle: 1 }]);
  returning.context.localStorage.setItem('aecp-dock-side', 'left');
  await returning.evaluate('renderBrowserDock()');
  assert.equal(returning.el('#dockBrowserLeftButton').getAttribute('aria-pressed'), 'true', 'the remembered side is shown on the next visit');
  assert.equal(returning.el('#dockBrowserRightButton').getAttribute('aria-pressed'), 'false');
});

test('B06-L31 the Windows Snap tip is in the shipped page next to the dock controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const hint = /id="snapHint"[^>]*>([^<]*)</.exec(html);
  assert.ok(hint, 'the hint element exists');
  assert.match(hint[1], /Windows Snap/);
  assert.match(hint[1], /Win\+Left/);
  assert.ok(html.indexOf('id="snapHint"') > html.indexOf('id="dockBrowserRightButton"'), 'it sits after the dock buttons');
});
