'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./support/fake-electron-main.cjs');
const settings = require('../electron/lib/agent-settings.cjs');
const { CodexWorkerRuntime } = require('../electron/lib/codex-worker-runtime.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { IPC_SCHEMAS, validatePayload } = require('../electron/lib/ipc-validation.cjs');

const legacyOfficial = (model) => [
  '# AECP-managed isolated Codex OFFICIAL worker.',
  '# Authentication/session files remain inside this CODEX_HOME only.',
  ...(model ? ['model = ' + JSON.stringify(model)] : []),
  'approval_policy = "never"',
  'sandbox_mode = "workspace-write"',
  'cli_auth_credentials_store = "file"',
  '',
  '[windows]',
  'sandbox = "unelevated"',
  ''
].join('\n');

const legacyCustom = (model) => [
  '# AECP-managed isolated Codex worker.',
  '# Secrets are never written here; env_key points to an in-memory process environment value.',
  'model = ' + JSON.stringify(model),
  'model_provider = "pega"',
  'approval_policy = "never"',
  'sandbox_mode = "workspace-write"',
  '',
  '[model_providers.pega]',
  'name = "PEGA"',
  'base_url = "https://pega.example.test/v1"',
  'wire_api = "responses"',
  'env_key = "PEGA_API_KEY"',
  'requires_openai_auth = false',
  '',
  '[windows]',
  'sandbox = "unelevated"',
  ''
].join('\n');

const custom = (runtime, extra = {}) => runtime.prepareCustom({
  workerId: 'codex-pega', workerName: 'Codex PEGA', providerId: 'pega', providerName: 'PEGA', baseUrl: 'https://pega.example.test/v1',
  model: 'Pega-Coding', wireApi: 'responses', envKey: 'PEGA_API_KEY', apiKey: 'sk-live-SECRET-VALUE-1234567890', ...extra
});

async function tmp(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecp-agentset-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('B0019 settings patches are whitelisted: agent ids, model names and per-agent effort levels', () => {
  assert.deepEqual(settings.cleanPatch('codex-official', { model: 'gpt-5.1-codex', effort: 'high' }), { model: 'gpt-5.1-codex', effort: 'high' });
  assert.deepEqual(settings.cleanPatch('claude-code', { model: 'sonnet', effort: 'max' }), { model: 'sonnet', effort: 'max' });
  assert.deepEqual(settings.cleanPatch('ollama', { model: 'qwen3:4b-instruct', effort: 'low' }), { model: 'qwen3:4b-instruct', effort: 'low' });
  assert.deepEqual(settings.cleanPatch('ollama', { model: '', effort: '' }), { model: null, effort: null }, 'empty clears');
  assert.deepEqual(settings.cleanPatch('ollama', {}), {}, 'an untouched field stays untouched');
  for (const model of ['-leading', 'has space', 'semi;colon', 'a'.repeat(121), '$(calc)', '../x', 'x\ny', 7, {}]) assert.throws(() => settings.cleanPatch('opencode', { model }), /Model name/, String(model));
  for (const [agent, effort] of [['codex-official', 'max'], ['claude-code', 'minimal'], ['ollama', 'xhigh'], ['codex-pega', 'ultra'], ['claude-code', 'HIGH'], ['ollama', 7]]) assert.throws(() => settings.cleanPatch(agent, { effort }), /Effort must be one of/, agent + effort);
  for (const agent of ['gemini-cli', 'opencode', 'codex-cli']) assert.throws(() => settings.cleanPatch(agent, { effort: 'high' }), /does not support/, agent);
  for (const agentId of ['chatgpt-web', 'cmd; calc', '', undefined, 'constructor']) assert.throws(() => settings.cleanPatch(agentId, { model: 'x' }), /Unsupported agent/, String(agentId));
});

test('B0019 stored settings are read defensively and merged without touching other agents', () => {
  const raw = { 'claude-code': { model: 'opus', effort: 'high', extra: 'dropped' }, ollama: { model: 'bad model', effort: 'max' }, 'unknown-agent': { model: 'x' }, opencode: 'nope' };
  assert.deepEqual(settings.readSettings(raw), { 'claude-code': { model: 'opus', effort: 'high' } });
  assert.deepEqual(settings.readSettings(undefined), {}, 'a state.json without agentSettings reads as no settings');
  assert.deepEqual(settings.readSettings([]), {});
  let next = settings.applyPatch({}, 'ollama', { model: 'llama3.2:3b' });
  next = settings.applyPatch(next, 'codex-official', { effort: 'low' });
  assert.deepEqual(next, { ollama: { model: 'llama3.2:3b' }, 'codex-official': { effort: 'low' } });
  next = settings.applyPatch(next, 'ollama', { model: null });
  assert.deepEqual(next, { 'codex-official': { effort: 'low' } }, 'clearing the last field removes the entry');
});

test('B0019 the effective model prefers the setting, then the provider entry (PEGA), then the environment, then the tool default', () => {
  const env = { AECP_CODEX_OFFICIAL_MODEL: 'env-model', AECP_OLLAMA_MODEL: 'env-ollama' };
  assert.deepEqual(settings.effective('codex-official', { settings: { 'codex-official': { model: 'set-model', effort: 'low' } }, env }),
    { model: 'set-model', modelSource: 'settings', effort: 'low', effortSupported: true, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] });
  assert.equal(settings.effective('codex-official', { settings: {}, env }).modelSource, 'env');
  assert.equal(settings.effective('codex-official', { settings: {}, env: {} }).model, null, 'nothing is invented when nothing is chosen');
  assert.equal(settings.effective('codex-official', { settings: {}, env: {} }).modelSource, 'default');
  assert.equal(settings.effective('codex-pega', { settings: {}, env, providerModel: 'Pega-Coding' }).modelSource, 'provider');
  assert.equal(settings.effective('codex-pega', { settings: { 'codex-pega': { model: 'override' } }, env, providerModel: 'Pega-Coding' }).model, 'override');
  assert.equal(settings.effective('ollama', { settings: {}, env }).modelSource, 'env');
  assert.equal(settings.effective('gemini-cli', { settings: {}, env }).effortSupported, false);
  assert.deepEqual(settings.effective('claude-code', { settings: {}, env: {} }).efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('B0019 OFFICIAL config: a reasoning effort is written before every [table], never with a secret, and no effort leaves the file byte-for-byte as before', async (t) => {
  const runtime = new CodexWorkerRuntime(await tmp(t));
  const file = (id) => path.join(runtime.codexHome(id), 'config.toml');
  await runtime.prepareOfficial({});
  assert.equal(await fsp.readFile(file('codex-official'), 'utf8'), legacyOfficial(null));
  await runtime.prepareOfficial({ model: 'gpt-x' });
  assert.equal(await fsp.readFile(file('codex-official'), 'utf8'), legacyOfficial('gpt-x'));
  const profile = await runtime.prepareOfficial({ model: 'gpt-x', effort: 'xhigh' });
  const text = await fsp.readFile(file('codex-official'), 'utf8');
  assert.match(text, /^model_reasoning_effort = "xhigh"$/m);
  assert.ok(text.indexOf('model_reasoning_effort') < text.indexOf('\n['), 'a top-level key must come before any table');
  assert.equal(text.replace('model_reasoning_effort = "xhigh"\n', ''), legacyOfficial('gpt-x'), 'the only difference is that one line');
  assert.equal(profile.effort, 'xhigh');
  for (const effort of ['ultra', 'HIGH', 'high"\n[x]', 7, {}]) await assert.rejects(() => runtime.prepareOfficial({ effort }), /reasoning effort/, JSON.stringify(effort));
  assert.equal(await fsp.readFile(file('codex-official'), 'utf8'), text, 'a refused effort does not rewrite the file');
});

test('B0019 PEGA config: effort sits before [model_providers], the key never reaches the file, and without an effort the file is unchanged', async (t) => {
  const runtime = new CodexWorkerRuntime(await tmp(t));
  const file = path.join(runtime.codexHome('codex-pega'), 'config.toml');
  await custom(runtime);
  assert.equal(await fsp.readFile(file, 'utf8'), legacyCustom('Pega-Coding'));
  const profile = await custom(runtime, { effort: 'medium' });
  const text = await fsp.readFile(file, 'utf8');
  assert.ok(text.indexOf('model_reasoning_effort = "medium"') > -1 && text.indexOf('model_reasoning_effort') < text.indexOf('[model_providers.'));
  assert.equal(text.replace('model_reasoning_effort = "medium"\n', ''), legacyCustom('Pega-Coding'));
  assert.ok(!text.includes('SECRET-VALUE'), 'the key is only in the process environment');
  assert.equal(profile.env.PEGA_API_KEY, 'sk-live-SECRET-VALUE-1234567890');
  await assert.rejects(() => custom(runtime, { effort: 'max' }), /reasoning effort/);
});

test('B0019 CLI flags: model and effort travel as separate array elements, and with nothing set the arguments are exactly what they were', () => {
  const router = new ProviderRouter(PROVIDERS);
  assert.deepEqual(router.commandSpec('claude', 'planner', 'P', {}).args, ['-p', 'P', '--output-format', 'json', '--permission-mode', 'plan', '--max-turns', '12']);
  assert.deepEqual(router.commandSpec('claude', 'planner', 'P', { model: 'sonnet', effort: 'high' }).args,
    ['-p', 'P', '--output-format', 'json', '--permission-mode', 'plan', '--max-turns', '12', '--model', 'sonnet', '--effort', 'high']);
  assert.deepEqual(router.commandSpec('ollama', 'general', 'P', { model: 'm' }).args, ['run', 'm', 'P']);
  assert.deepEqual(router.commandSpec('ollama', 'general', 'P', { model: 'm', effort: 'medium' }).args, ['run', 'm', 'P', '--think=medium'], '--think must follow the model/prompt or Ollama can mis-parse the model as the flag value');
  assert.deepEqual(router.commandSpec('gemini', 'general', 'P', { model: 'g' }).args, ['--approval-mode', 'plan', '-p', 'P', '--model', 'g']);
  const codex = router.commandSpec('codex', 'builder', 'P', { model: 'c', cwd: '/w' }).args;
  assert.ok(!codex.includes('--skip-git-repo-check'), 'the flag is off unless asked for');
  const skipped = router.commandSpec('codex', 'builder', 'P', { model: 'c', cwd: '/w', skipGitRepoCheck: true }).args;
  assert.deepEqual(skipped.filter((arg) => arg !== '--skip-git-repo-check'), codex);
  assert.ok(skipped.indexOf('--skip-git-repo-check') < skipped.indexOf('--model'));
  assert.ok(skipped.includes('workspace-write') && !skipped.includes('danger-full-access'), 'the sandbox stays workspace-write');
  for (const effort of ['ultra', 'minimal', 'high; calc', '--help']) assert.throws(() => router.commandSpec('claude', 'planner', 'P', { effort }), /Claude effort/, effort);
  for (const effort of ['max', 'xhigh', 'true', '--help']) assert.throws(() => router.commandSpec('ollama', 'general', 'P', { model: 'm', effort }), /thinking level/, effort);
});

test('B0019 a stored default effort reaches the CLI flags for planner and reviewer calls too', () => {
  const registry = { ...PROVIDERS, claude: { ...PROVIDERS.claude, defaultModel: 'opus', defaultEffort: 'low' } };
  const args = new ProviderRouter(registry).commandSpec('claude', 'reviewer', 'P', {}).args;
  assert.deepEqual(args.slice(-4), ['--model', 'opus', '--effort', 'low']);
});

test('B0019 the new IPC channels are declared, whitelisted and strict', () => {
  for (const channel of ['agents:settings:get', 'agents:settings:set', 'agents:say-hi']) assert.ok(IPC_SCHEMAS[channel], channel);
  assert.doesNotThrow(() => validatePayload('agents:settings:get', IPC_SCHEMAS['agents:settings:get'], undefined));
  assert.throws(() => validatePayload('agents:settings:get', IPC_SCHEMAS['agents:settings:get'], { x: 1 }), /Invalid IPC request/);
  const ok = (channel, payload) => assert.doesNotThrow(() => validatePayload(channel, IPC_SCHEMAS[channel], payload), JSON.stringify(payload));
  const bad = (channel, payload) => assert.throws(() => validatePayload(channel, IPC_SCHEMAS[channel], payload), /Invalid IPC request/, JSON.stringify(payload));
  ok('agents:settings:set', { agentId: 'claude-code', model: 'sonnet', effort: 'high' });
  ok('agents:settings:set', { agentId: 'ollama', effort: '' });
  for (const payload of [{ agentId: 'chatgpt-web', model: 'x' }, { agentId: 'cmd; calc' }, { agentId: 'ollama', effort: 'ultra' }, { agentId: 'ollama', model: 'm', extra: 1 }, { model: 'x' }, { agentId: 'ollama', model: 'x'.repeat(200) }]) bad('agents:settings:set', payload);
  ok('agents:say-hi', { agentId: 'ollama', model: 'qwen3:4b-instruct' });
  for (const payload of [{ agentId: 'chatgpt-web' }, { agentId: 'ollama', prompt: 'my own words' }, { agentId: 'ollama', text: 'hi' }, {}]) bad('agents:say-hi', payload);
});

test('B0019 through the real main process: settings persist, drive the OFFICIAL config, and an old state.json shows no settings', async (t) => {
  const ctx = loadMain();
  const H = (channel, payload) => ctx.handlers[channel]({}, payload);
  t.after(() => ctx.dispose());
  await ctx.start();
  const before = await H('agents:settings:get');
  assert.equal(before.schema, 'aecp.agent-settings/v1');
  const byId = Object.fromEntries(before.agents.map((agent) => [agent.id, agent]));
  assert.deepEqual(Object.keys(byId).sort(), ['chatgpt-web', 'claude-code', 'codex-cli', 'codex-official', 'codex-pega', 'gemini-cli', 'ollama', 'opencode']);
  assert.equal(byId['codex-official'].name, 'Codex OFFICIAL (OpenAI Official)');
  assert.equal(byId['codex-official'].model, null, 'no model is invented');
  assert.equal(byId['codex-official'].modelSource, 'default');
  assert.equal(byId['claude-code'].effortSupported, true);
  assert.equal(byId.opencode.effortSupported, false);
  assert.equal(byId['chatgpt-web'].controllable, false, 'the official website is not controllable');
  assert.equal(byId['chatgpt-web'].sayHi.supported, false);
  const stateFile = path.join(ctx.userData, 'state.json');
  const readState = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {});
  assert.equal(readState().agentSettings, undefined, 'an old state.json gains no field by being read');

  const official = path.join(ctx.userData, 'workers', 'codex-official', 'codex-home', 'config.toml');
  await H('provider:list');
  assert.equal(fs.readFileSync(official, 'utf8'), legacyOfficial(null), 'with no settings the OFFICIAL config is exactly the old one');

  const after = await H('agents:settings:set', { agentId: 'codex-official', model: 'gpt-5.1-codex', effort: 'high' });
  assert.equal(after.agents.find((agent) => agent.id === 'codex-official').model, 'gpt-5.1-codex');
  assert.equal(after.agents.find((agent) => agent.id === 'codex-official').modelSource, 'settings');
  await H('provider:list');
  const text = fs.readFileSync(official, 'utf8');
  assert.match(text, /^model = "gpt-5\.1-codex"$/m);
  assert.match(text, /^model_reasoning_effort = "high"$/m);
  assert.ok(text.indexOf('model_reasoning_effort') < text.indexOf('\n['));
  assert.deepEqual(readState().agentSettings, { 'codex-official': { model: 'gpt-5.1-codex', effort: 'high' } });

  await assert.rejects(() => H('agents:settings:set', { agentId: 'codex-official', effort: 'ultra' }), /Invalid IPC request/);
  await assert.rejects(() => H('agents:settings:set', { agentId: 'ollama', model: 'bad model name' }), /Model name/);
  await assert.rejects(() => H('agents:settings:set', { agentId: 'chatgpt-web', model: 'x' }), /Invalid IPC request/);

  await H('agents:settings:set', { agentId: 'codex-official', model: '', effort: '' });
  await H('provider:list');
  assert.equal(fs.readFileSync(official, 'utf8'), legacyOfficial(null), 'clearing the settings restores the old file exactly');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
