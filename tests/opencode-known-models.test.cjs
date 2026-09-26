'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');

// Stands in for the real `opencode` executable so `execFile('opencode', ['models'], ...)` never runs a real process.
const fake = { installed: true, output: 'opencode/big-pickle\nopencode/ling-3.0-flash-fin-free\nollama/qwen3-coder:30b\n', delayMs: 0, error: null, calls: [] };
const realExecFile = cp.execFile;
cp.execFile = function execFile(command, args, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  if (command !== 'opencode') return realExecFile.apply(this, arguments);
  fake.calls.push({ command, args, options });
  if (!fake.installed) { const error = Object.assign(new Error('not found'), { code: 'ENOENT' }); setTimeout(() => cb(error, '', ''), fake.delayMs); return {}; }
  if (fake.error) { setTimeout(() => cb(fake.error, '', String(fake.error.message || '')), fake.delayMs); return {}; }
  setTimeout(() => cb(null, fake.output, ''), fake.delayMs);
  return {};
};

const { loadMain } = require('./support/fake-electron-main.cjs');
const { parseOpenCodeModels } = require('../electron/lib/agent-settings.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { createUi } = require('./support/ui-harness.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
test.before(async () => { await ctx.start(); });
test.after(() => { cp.execFile = realExecFile; ctx.dispose(); setImmediate(() => process.exit(process.exitCode || 0)); });
test.beforeEach(() => { fake.installed = true; fake.error = null; fake.delayMs = 0; fake.calls = []; fake.output = 'opencode/big-pickle\nopencode/ling-3.0-flash-fin-free\nollama/qwen3-coder:30b\n'; });

test('B0022 parseOpenCodeModels keeps only valid provider/model lines from real `opencode models` output, in provider/model form', () => {
  const real = [
    'opencode/big-pickle',
    'opencode/ling-3.0-flash-fin-free',
    '',
    'ollama/qwen3-coder:30b',
    'a line of log noise: connecting to models.dev',
    '  ',
    'bad line with spaces'
  ].join('\n');
  assert.deepEqual(parseOpenCodeModels(real), ['opencode/big-pickle', 'opencode/ling-3.0-flash-fin-free', 'ollama/qwen3-coder:30b']);
  assert.deepEqual(parseOpenCodeModels(''), []);
  assert.deepEqual(parseOpenCodeModels(null), []);
});

test('B0022 the --model flag takes exactly what the list gives back, with no reformatting', () => {
  const args = new ProviderRouter(PROVIDERS).commandSpec('opencode', 'builder', 'P', { model: 'ollama/qwen3-coder:30b' }).args;
  assert.ok(args.includes('--model') && args[args.indexOf('--model') + 1] === 'ollama/qwen3-coder:30b');
});

test('B0022 the settings view lists real opencode models via a fixed, argument-free call, timed out and output-bounded', async () => {
  const view = await H('agents:settings:get');
  const opencode = view.agents.find((agent) => agent.id === 'opencode');
  assert.deepEqual(opencode.knownModels, ['opencode/big-pickle', 'opencode/ling-3.0-flash-fin-free', 'ollama/qwen3-coder:30b']);
  assert.equal(opencode.knownModelsUnavailable, undefined);
  const call = fake.calls.find((entry) => entry.command === 'opencode');
  assert.deepEqual(call.args, ['models'], 'no user-controlled argument is ever passed');
  assert.ok(Number.isInteger(call.options?.timeout) && call.options.timeout > 0 && call.options.timeout <= 15000, 'a bounded timeout is set');
  assert.ok(Number.isInteger(call.options?.maxBuffer) && call.options.maxBuffer > 0, 'output is bounded');
});

test('B0022 opencode not being installed, erroring, timing out, or printing nothing usable all fall back gracefully, not throw', async () => {
  for (const scenario of [
    { installed: false },
    { error: Object.assign(new Error('boom'), { code: 1 }) },
    { output: '\n\n   \n' },
    { output: 'nonsense output with no slashes anywhere' }
  ]) {
    Object.assign(fake, { installed: true, error: null, output: fake.output }, scenario);
    const view = await H('agents:settings:get');
    const opencode = view.agents.find((agent) => agent.id === 'opencode');
    assert.equal(opencode.knownModels, undefined, JSON.stringify(scenario));
    assert.equal(opencode.knownModelsUnavailable, true, JSON.stringify(scenario));
  }
});

test('B0022 a previously saved custom value for OpenCode is kept and shown as Custom when the list is available', async () => {
  await H('agents:settings:set', { agentId: 'opencode', model: 'anthropic/claude-sonnet-5' });
  const view = await H('agents:settings:get');
  const opencode = view.agents.find((agent) => agent.id === 'opencode');
  const ui = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
    listAgents: [{ id: 'opencode', name: 'OpenCode', role: 'local-agent', available: true, version: 'v' }],
    getAgentSettings: { schema: 'aecp.agent-settings/v1', ollamaModels: [], agents: [opencode] }
  } });
  await ui.settle();
  const html = ui.el('#agentList').innerHTML;
  assert.match(html, /<option value="__custom__" selected>Custom…<\/option>/);
  assert.match(html, /<input data-agent-model="opencode" type="text" maxlength="120" value="anthropic\/claude-sonnet-5"/);
  await H('agents:settings:set', { agentId: 'opencode', model: '' });
});

test('B0022 when the list cannot be read, OpenCode falls back to the plain text field and says why', async () => {
  fake.installed = false;
  const view = await H('agents:settings:get');
  const opencode = view.agents.find((agent) => agent.id === 'opencode');
  const ui = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
    listAgents: [{ id: 'opencode', name: 'OpenCode', role: 'local-agent', available: true, version: 'v' }],
    getAgentSettings: { schema: 'aecp.agent-settings/v1', ollamaModels: [], agents: [opencode] }
  } });
  await ui.settle();
  const html = ui.el('#agentList').innerHTML;
  assert.match(html, /<input data-agent-model="opencode" type="text" maxlength="120" value="" placeholder="Use the default">/);
  assert.doesNotMatch(html, /__custom__/);
  assert.match(html, /Could not read the model list; please type it manually\./);
});

test('B0022 Gemini CLI: no alias/list command exists on real `gemini --help`, so it honestly keeps the free-text field with its own note', async () => {
  const view = await H('agents:settings:get');
  const gemini = view.agents.find((agent) => agent.id === 'gemini-cli');
  assert.equal(gemini.knownModels, undefined);
  assert.equal(gemini.knownModelsUnavailable, true);
  const ui = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
    listAgents: [{ id: 'gemini-cli', name: 'Gemini CLI', role: 'research-coding', available: true, version: 'v' }],
    getAgentSettings: { schema: 'aecp.agent-settings/v1', ollamaModels: [], agents: [gemini] }
  } });
  await ui.settle();
  const html = ui.el('#agentList').innerHTML;
  assert.match(html, /<input data-agent-model="gemini-cli" type="text" maxlength="120" value="" placeholder="Use the default">/);
  assert.match(html, /This tool has no auto-detectable model list; please type it manually\./);
  assert.doesNotMatch(html, /Could not read the model list/, 'this is a permanent state, not a failed attempt message');
});
