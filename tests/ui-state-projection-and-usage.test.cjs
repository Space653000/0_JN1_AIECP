'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUi } = require('./support/ui-harness.cjs');
const { ProviderUsageStore } = require('../electron/lib/provider-usage.cjs');

const WORKSPACE = {
  id: 'ws-1', name: 'Demo', rootPath: '/demo', policy: { maxRisk: 'YELLOW' },
  repositories: [{ id: 'repo-1', name: 'demo-repo', path: '/demo', branch: 'main', dirty: true, remote: 'github.com/o/r' }]
};
const TASKS = [
  { id: 'TASK-1', title: 'Inspect repository', goal: 'Read only inspection', state: 'DONE', risk: 'GREEN', riskReason: 'read only', createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:01:00Z', card: { action: { type: 'git-status' }, permissions: ['workspace:read'] }, executionContract: { schema: 'aecp.execution-contract/v1', goal: 'Read only inspection', definitionOfDone: 'Evidence exists', transport: 'web-safe-bridge' }, result: { schema: 'aecp.result/v1', taskId: 'TASK-1', status: 'PASS', facts: ['Branch: main'], evidenceRef: 'local://evidence/TASK-1', verification: { status: 'PASS', method: 'operation-success' } } },
  { id: 'TASK-2', title: 'Needs a person', goal: 'Blocked on approval', state: 'HUMAN_REQUIRED', risk: 'RED', riskReason: 'push', createdAt: '2026-09-25T00:02:00Z', updatedAt: '2026-09-25T00:03:00Z', card: { action: { type: 'inspect-workspace' }, permissions: [] } }
];
const PROVIDERS = [
  { id: 'chatgpt-web', name: 'ChatGPT Web', kind: 'web', status: 'READY', builtIn: true, usageManagedExternally: true },
  { id: 'api-1', name: 'Company API', kind: 'api', status: 'READY', hasCredential: true, defaultModel: 'gpt-x', baseUrl: 'https://api.example.com/v1', usage: { requests: 3, successes: 2, failures: 1, averageLatencyMs: 812, numericTotals: { 'usage.total_tokens': 4200 } } },
  { id: 'local-1', name: 'Local Ollama', kind: 'local', status: 'DEGRADED', usage: { requests: 0 } }
];
const AGENTS = [
  { id: 'chatgpt-web', name: 'ChatGPT Web', role: 'supervisor', available: true, version: 'Official web', usageManagedExternally: true },
  { id: 'codex-cli', name: 'Codex CLI', role: 'coding', available: true, version: 'codex 1.2.3', usage: { requests: 5, successes: 5, failures: 0, averageLatencyMs: 90, numericTotals: { 'usage.total_tokens': 900, cost_usd: 0.0123 } } },
  { id: 'claude-code', name: 'Claude Code', role: 'coding', available: true, version: 'claude 2.0', usage: null },
  { id: 'gemini-cli', name: 'Gemini CLI', role: 'research-coding', available: false, version: 'Not found', usage: null }
];
const RESPONSES = {
  getState: { currentWorkspace: WORKSPACE, providers: PROVIDERS, workspaces: [WORKSPACE] },
  listTasks: TASKS, listProviders: PROVIDERS, listAgents: AGENTS,
  getGuidance: { action: 'REVIEW_APPROVAL', label: 'Review approval', detail: 'A governed action is waiting for your decision.', taskId: 'TASK-2' },
  detectTools: [{ id: 'git', name: 'Git', available: true, version: 'git 2.x' }],
  getHarnessStatus: { state: 'IDLE' }, getAutonomyStatus: { state: 'IDLE' }, getAutonomyOptions: { providers: [] }
};
const VIEWS = ['start', 'board', 'pipeline', 'loop', 'graph', 'evidence'];

async function boot(extra = {}) {
  const ui = createUi({ responses: { ...RESPONSES, ...extra } });
  await ui.settle();
  return ui;
}
const snapshotOf = (ui) => ({
  content: ui.el('#controlContent').innerHTML,
  title: ui.el('#controlTitle').textContent,
  repos: ui.el('#repoList').innerHTML,
  tools: ui.el('#toolList').innerHTML,
  agents: ui.el('#agentList').innerHTML,
  providers: ui.el('#providerList').innerHTML,
  workspace: [ui.el('#workspaceName').textContent, ui.el('#workspacePath').textContent, ui.el('#workspaceState').textContent].join('|')
});

test('R8.2 Beginner and Engineering mode render exactly the same content from the same underlying state, in every view', async () => {
  const ui = await boot();
  assert.equal(ui.evaluate('state.engineering'), false);
  assert.ok(ui.evaluate('state.tasks').length === 2 && ui.evaluate('state.providers').length === 3, 'the real state was loaded');
  for (const view of VIEWS) {
    ui.evaluate(`state.view = '${view}'; state.selectedTaskId = 'TASK-1'; render()`);
    const beginner = snapshotOf(ui);
    const stateBefore = JSON.stringify({ tasks: ui.evaluate('state.tasks'), data: ui.evaluate('state.data'), providers: ui.evaluate('state.providers'), agents: ui.evaluate('state.agents') });
    ui.evaluate('state.engineering = true; render()');
    const engineering = snapshotOf(ui);
    assert.equal(ui.document.body.classList.contains('engineering-mode'), true);
    assert.deepEqual(engineering, beginner, `the ${view} view must project identical content in both modes (engineering-only controls are hidden by CSS, not removed or changed)`);
    assert.equal(JSON.stringify({ tasks: ui.evaluate('state.tasks'), data: ui.evaluate('state.data'), providers: ui.evaluate('state.providers'), agents: ui.evaluate('state.agents') }), stateBefore, 'the mode does not change the state');
    ui.evaluate('state.engineering = false; render()');
    assert.deepEqual(snapshotOf(ui), beginner, 'and switching back restores the same projection');
    if (view !== 'evidence') assert.ok(beginner.content.length > 100, `${view} rendered something`);
  }
  ui.evaluate("state.view = 'board'; render()");
  assert.match(snapshotOf(ui).content, /Needs a person|TASK-2|Inspect repository/, 'task data really reaches the rendered views');
});

test('R8.2 the same task fields are visible in both modes, including the engineering-only details', async () => {
  const ui = await boot();
  ui.evaluate("state.view = 'board'; state.selectedTaskId = 'TASK-2'; render()");
  const beginner = ui.el('#controlContent').innerHTML;
  ui.evaluate('state.engineering = true; render()');
  const engineering = ui.el('#controlContent').innerHTML;
  for (const field of ['Needs a person', 'HUMAN_REQUIRED', 'RED', 'TASK-2']) {
    assert.ok(beginner.includes(field) && engineering.includes(field), `${field} is shown in both modes`);
  }
});

test('B16-L171 provider and adapter quota is shown as observed usage or as externally managed, never as unlimited', async () => {
  const ui = await boot();
  const agents = ui.el('#agentList').innerHTML;
  const providers = ui.el('#providerList').innerHTML;
  assert.match(agents, /subscription-managed externally/, 'ChatGPT quota is owned by the subscription, not by AECP');
  assert.match(agents, /5 requests · 5 ok \/ 0 failed · avg 90 ms · 900 total tokens · reported cost 0\.0123/, 'only provider-reported numbers are shown, with their unit');
  assert.equal((agents.match(/no recorded invocations/g) || []).length, 2, 'adapters with no usage data say so instead of implying capacity');
  assert.match(agents, /Gemini CLI[\s\S]*Not detected/);
  assert.match(providers, /3 requests · 2 ok \/ 1 failed · avg 812 ms · 4200 total tokens/);
  assert.match(providers, /no recorded invocations/);
  for (const html of [agents, providers, ui.el('#controlContent').innerHTML]) {
    assert.doesNotMatch(html, /unlimited|no limit|no quota|infinite|free of charge|without limit/i);
  }
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'ui', 'i18n.js'), 'utf8');
  assert.doesNotMatch(i18n, /unlimited|no quota|infinite|without limit/i, 'no translated string can imply unlimited use either');
  assert.equal(ui.evaluate("formatProviderUsage(null, true)"), 'subscription-managed externally');
  assert.equal(ui.evaluate('formatProviderUsage({ requests: 0 })'), 'no recorded invocations');
  assert.equal(ui.evaluate('formatProviderUsage(undefined)'), 'no recorded invocations');
});

test('B16-L171 the usage store records only numbers a provider reported and never invents a quota or a remaining balance', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-usage-'));
  try {
    const store = new ProviderUsageStore(path.join(dir, 'usage.json'));
    await store.append({ provider: 'codex', role: 'builder', success: true, latencyMs: 120, usage: { total_tokens: 100, note: 'not numeric', quota_remaining: 12, cost_usd: 0.5 } });
    await store.append({ provider: 'codex', role: 'builder', success: false, latencyMs: 80 });
    await store.append({ provider: 'gemini', role: 'planner', success: true, latencyMs: 40, usage: { message: 'unlimited plan' } });
    const summaries = await store.summaries();
    assert.equal(summaries.codex.requests, 2);
    assert.deepEqual(summaries.codex.numericTotals, { total_tokens: 100, cost_usd: 0.5 });
    assert.deepEqual(summaries.gemini.numericTotals, {}, 'text such as "unlimited plan" is not stored as usage');
    const stored = fs.readFileSync(path.join(dir, 'usage.json'), 'utf8');
    assert.doesNotMatch(stored, /unlimited|plenty|quota_remaining|remaining/i);
    for (const summary of Object.values(summaries)) assert.ok(!Object.keys(summary).some((key) => /quota|limit|remaining|balance/i.test(key)), 'the summary has no quota, limit or remaining-balance field');
    await assert.rejects(() => store.append({ role: 'builder' }), /requires provider id/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
