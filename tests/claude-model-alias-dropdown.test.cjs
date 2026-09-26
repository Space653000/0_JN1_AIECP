'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi } = require('./support/ui-harness.cjs');
const { CLAUDE_MODEL_ALIASES } = require('../electron/lib/agent-settings.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');

test('B0021 CLAUDE_MODEL_ALIASES is a fixed named constant, and it drives the --model flag exactly as any other value would', () => {
  assert.deepEqual([...CLAUDE_MODEL_ALIASES], ['sonnet', 'opus', 'fable']);
  const args = new ProviderRouter(PROVIDERS).commandSpec('claude', 'planner', 'P', { model: 'sonnet' }).args;
  assert.deepEqual(args.slice(-2), ['--model', 'sonnet'], 'the alias travels through --model unchanged, no translation');
});

const row = (extra = {}) => ({ id: 'claude-code', name: 'Claude Code', kind: 'cli', model: null, modelSource: 'default', effort: null, effortSupported: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], knownModels: [...CLAUDE_MODEL_ALIASES], sayHi: { supported: true, network: true, keyConfigured: null }, ...extra });
const VIEW = (claude) => ({ schema: 'aecp.agent-settings/v1', ollamaModels: [], agents: [claude] });
const AGENTS = [{ id: 'claude-code', name: 'Claude Code', role: 'coding', available: true, version: 'claude 2.0' }];
const base = { getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [], listAgents: AGENTS };
async function boot(claude, extra = {}) {
  const ui = createUi({ responses: { ...base, getAgentSettings: VIEW(claude), ...extra } });
  await ui.settle();
  return ui;
}
const panel = (source) => { const start = source.indexOf('data-agent-settings="claude-code"'); return source.slice(start, source.indexOf('</details>', start)); };
const clickWith = (ui, selector, dataset) => ui.document.listeners.click[0]({ target: { closest: (asked) => (asked === selector ? { dataset } : null) } });
const changeWith = (ui, selector, dataset, value, tagName = 'SELECT') => ui.document.listeners.change[0]({ target: { closest: (asked) => (asked === selector ? { dataset, value, tagName } : null) } });

test('B0021 the Claude Code model field is a dropdown of the four fixed choices, not free text', async () => {
  const ui = await boot(row());
  const html = panel(ui.el('#agentList').innerHTML);
  assert.match(html, /<select data-agent-model="claude-code">/);
  for (const alias of ['sonnet', 'opus', 'fable']) assert.match(html, new RegExp('<option value="' + alias + '"'));
  assert.match(html, /<option value="__custom__"[^>]*>Custom…<\/option>/);
  assert.doesNotMatch(html, /<input data-agent-model="claude-code"/, 'no free-text box until Custom is chosen');
  assert.match(html, /official aliases that always resolve to the latest version/);
});

test('B0021 an existing full model name that is not one of the aliases is shown as Custom, with the value kept in a text box', async () => {
  const ui = await boot(row({ model: 'claude-3-7-sonnet-20260115', modelSource: 'settings' }));
  const html = panel(ui.el('#agentList').innerHTML);
  assert.match(html, /<option value="__custom__" selected>Custom…<\/option>/);
  assert.match(html, /<input data-agent-model="claude-code" type="text" maxlength="120" value="claude-3-7-sonnet-20260115"/);
  assert.doesNotMatch(html, /<option value="sonnet" selected>/);
});

test('B0021 picking "Custom…" reveals an empty text field without losing the panel, and typing into it is what gets saved', async () => {
  const saved = [];
  const ui = await boot(row(), { setAgentSettings: (agentId, patch) => { saved.push([agentId, patch]); return VIEW(row()); } });
  await changeWith(ui, '[data-agent-model]', { agentModel: 'claude-code' }, '__custom__', 'SELECT');
  await ui.settle();
  const afterSelect = panel(ui.el('#agentList').innerHTML);
  assert.match(afterSelect, /<input data-agent-model="claude-code" type="text" maxlength="120" value=""/, 'the field is empty, ready for typing');
  await changeWith(ui, '[data-agent-model]', { agentModel: 'claude-code' }, 'claude-3-7-sonnet-20260115', 'INPUT');
  await clickWith(ui, '[data-agent-save]', { agentSave: 'claude-code' });
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [['claude-code', { model: 'claude-3-7-sonnet-20260115', effort: '' }]]);
});

test('B0021 picking an alias saves exactly that alias, in the same --model shape as before', async () => {
  const saved = [];
  const ui = await boot(row(), { setAgentSettings: (agentId, patch) => { saved.push([agentId, patch]); return VIEW(row()); } });
  await changeWith(ui, '[data-agent-model]', { agentModel: 'claude-code' }, 'opus', 'SELECT');
  await clickWith(ui, '[data-agent-save]', { agentSave: 'claude-code' });
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [['claude-code', { model: 'opus', effort: '' }]]);
});

test('B0021 leaving the model unset (using the default) behaves exactly as before: no model is sent', async () => {
  const saved = [];
  const ui = await boot(row(), { setAgentSettings: (agentId, patch) => { saved.push([agentId, patch]); return VIEW(row()); } });
  await clickWith(ui, '[data-agent-save]', { agentSave: 'claude-code' });
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [['claude-code', { model: '', effort: '' }]]);
});

test('B0021 Ollama, PEGA and Codex OFFICIAL keep their own existing model fields, untouched by this change', async () => {
  const pegaRow = { id: 'codex-pega', name: 'Codex PEGA', kind: 'codex-worker', model: null, modelSource: 'default', effort: null, effortSupported: true, efforts: ['low'], sayHi: { supported: true, network: true, keyConfigured: false } };
  const officialRow = { id: 'codex-official', name: 'Codex OFFICIAL (OpenAI Official)', kind: 'codex-worker', model: 'gpt-5.1-codex', modelSource: 'settings', effort: null, effortSupported: true, efforts: ['low'], sayHi: { supported: true, network: true, keyConfigured: null } };
  const ollamaRow = { id: 'ollama', name: 'Local Ollama', kind: 'local', model: null, modelSource: 'default', effort: null, effortSupported: true, efforts: ['low'], sayHi: { supported: true, network: false, keyConfigured: null } };
  const view = { schema: 'aecp.agent-settings/v1', ollamaModels: ['qwen3:4b-instruct'], agents: [row(), pegaRow, officialRow, ollamaRow] };
  const ui = createUi({ responses: { ...base, getAgentSettings: view, listAgents: [...AGENTS, { id: 'ollama', name: 'Local Ollama', role: 'local-models', available: true, version: 'v' }] } });
  await ui.settle();
  const html = ui.el('#agentList').innerHTML;
  assert.match(html, /<input data-agent-model="codex-pega" type="text" maxlength="120" value="" placeholder="Use the default">/);
  assert.match(html, /<input data-agent-model="codex-official" type="text" maxlength="120" value="gpt-5\.1-codex"/);
  assert.match(html, /<select data-agent-model="ollama"><option value="">Use the default<\/option><option value="qwen3:4b-instruct"/, 'Ollama keeps its own installed-models select, no Custom option added');
  assert.doesNotMatch(html.slice(html.indexOf('codex-pega'), html.indexOf('codex-pega') + 600), /__custom__/);
});

test('B0021 through the real main process, the agent-settings view exposes the alias list for Claude Code and only for it', async () => {
  const { loadMain } = require('./support/fake-electron-main.cjs');
  const ctx = loadMain();
  await ctx.start();
  const view = await ctx.handlers['agents:settings:get']({});
  const byId = Object.fromEntries(view.agents.map((a) => [a.id, a]));
  assert.deepEqual(byId['claude-code'].knownModels, [...CLAUDE_MODEL_ALIASES]);
  for (const id of ['gemini-cli', 'opencode', 'codex-official', 'codex-pega', 'codex-cli']) {
    assert.equal(byId[id].knownModels, undefined, `${id} gets no knownModels from this work order`);
  }
  ctx.dispose();
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
