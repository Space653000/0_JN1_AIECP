'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

// Stand-ins for the agent programs. They are installed before main.cjs is loaded, so the real ProviderRouter,
// Worker Registry, usage store and IPC handlers run unchanged on top of them.
const fake = { spawns: [], execs: [], installed: new Set(['ollama']), models: ['qwen3:4b-instruct', 'llama3.2:3b'], answer: () => ({ stdout: 'Hello there!', code: 0, stderr: '' }), delayMs: 0, show: {} };
const realSpawn = cp.spawn;
const realExecFile = cp.execFile;
const FAKE_COMMANDS = new Set(['ollama', 'claude', 'codex']);
// On a machine that really has the official Codex app installed, command-resolver.cjs (0020 item A) resolves
// "codex" to that install's real codex.exe path before spawning, so the fake must match on the command's own
// basename too, not only the literal string "codex".
const isFake = (command) => FAKE_COMMANDS.has(command) || FAKE_COMMANDS.has(path.basename(String(command || '')).replace(/\.exe$/i, '').toLowerCase());
cp.execFile = function execFile(command, args, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  if (!isFake(command)) return realExecFile.apply(this, arguments);
  fake.execs.push({ command, args });
  if (!fake.installed.has(command)) { const error = Object.assign(new Error('not found'), { code: 'ENOENT' }); setImmediate(() => cb(error, '', '')); return {}; }
  const table = ['NAME ID SIZE MODIFIED', ...fake.models.map((name) => `${name}   abc123   2 GB   3 weeks ago`)].join('\n');
  const shown = args[0] === 'show' ? fake.show[args[1]] : undefined;
  setImmediate(() => cb(null, args[0] === 'list' ? table : shown !== undefined ? shown : `${command} version 9.9.9`, ''));
  return {};
};
cp.spawn = function spawn(command, args, options) {
  if (!isFake(command)) return realSpawn.apply(this, arguments);
  const call = { command, args: [...args], cwd: options?.cwd, env: { ...(options?.env || {}) } };
  fake.spawns.push(call);
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const finish = () => {
    const out = fake.answer(call);
    if (out.stdout) child.stdout.write(out.stdout);
    if (out.stderr) child.stderr.write(out.stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', out.code);
    child.emit('close', out.code);
  };
  setTimeout(finish, fake.delayMs);
  return child;
};
const { loadMain } = require('./support/fake-electron-main.cjs');
const { PEGA_ENV_KEY } = require('../electron/lib/pega-provider.cjs');
const { SayHiService, SAY_HI_PROMPT, SAY_HI_REPLY_BYTES, SAY_HI_TIMEOUT_MS } = require('../electron/lib/agent-settings.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const GH = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
test.before(async () => { await ctx.start(); });
test.after(() => {
  cp.spawn = realSpawn;
  cp.execFile = realExecFile;
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});
test.beforeEach(() => { fake.spawns.length = 0; fake.installed = new Set(['ollama']); fake.answer = () => ({ stdout: 'Hello there!', code: 0, stderr: '' }); fake.delayMs = 0; });

test('B0019 saying hi to Ollama sends exactly the fixed prompt with the chosen model and thinking level, from an empty AIECP-owned folder', async () => {
  await H('agents:settings:set', { agentId: 'ollama', model: 'qwen3:4b-instruct', effort: 'low' });
  const result = await H('agents:say-hi', { agentId: 'ollama' });
  assert.equal(result.ok, true);
  assert.equal(result.reply, 'Hello there!');
  assert.equal(result.model, 'qwen3:4b-instruct');
  assert.equal(result.agentName, 'Local Ollama');
  assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);
  assert.equal(fake.spawns.length, 1);
  assert.deepEqual(fake.spawns[0].args, ['run', 'qwen3:4b-instruct', SAY_HI_PROMPT, '--think=low']);
  assert.equal(SAY_HI_PROMPT, 'Reply with one short greeting sentence.');
  const cwd = fake.spawns[0].cwd;
  assert.equal(path.resolve(cwd), path.resolve(ctx.userData, 'say-hi', 'ollama'), 'the greeting runs in a folder AIECP owns');
  assert.deepEqual(fs.readdirSync(cwd), [], 'and that folder is empty');
});

test('B0019 the model can be picked per greeting and nothing else about the prompt can be chosen', async () => {
  await H('agents:settings:set', { agentId: 'ollama', model: '', effort: '' });
  const result = await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  assert.equal(result.ok, true);
  assert.deepEqual(fake.spawns[0].args, ['run', 'llama3.2:3b', SAY_HI_PROMPT], 'no thinking flag when none is set: the call is the one AIECP always made');
  for (const extra of [{ prompt: 'write me a poem' }, { text: 'hi' }, { message: 'hi' }, { args: ['--help'] }]) await assert.rejects(() => H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b', ...extra }), /Invalid IPC request/);
  await assert.rejects(() => H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b; calc' }), /Model name/);
  assert.equal(fake.spawns.length, 1, 'refused requests never reach a process');
});

test('B0019 the settings view lists the installed Ollama models from the fixed read-only list command', async () => {
  const view = await H('agents:settings:get');
  assert.deepEqual(view.ollamaModels, ['qwen3:4b-instruct', 'llama3.2:3b']);
  fake.models = ['ok-model:1b', '-leading-dash', '$(calc)', 'x'.repeat(200)];
  assert.deepEqual((await H('agents:settings:get')).ollamaModels, ['ok-model:1b'], 'names are filtered by the same pattern as typed ones');
  fake.models = ['qwen3:4b-instruct', 'llama3.2:3b'];
});

test('B0019 a greeting is recorded as a provider call but never creates a task or a Mission', async () => {
  await H('agents:settings:set', { agentId: 'ollama', model: 'qwen3:4b-instruct' });
  const before = (await H('agents:list')).find((agent) => agent.id === 'ollama').usage?.requests || 0;
  await H('agents:say-hi', { agentId: 'ollama' });
  const after = (await H('agents:list')).find((agent) => agent.id === 'ollama').usage;
  assert.equal(after.requests, before + 1, 'the call count goes up');
  assert.deepEqual(await H('task:list'), []);
  assert.equal(fs.existsSync(path.join(ctx.userData, 'control-plane')), false, 'no Mission or queue state is created');
});

test('B0019 the reply is redacted and cut to 2 KB, and a failure keeps its real reason', async () => {
  fake.answer = () => ({ stdout: `Hi! my token is ${GH} ` + 'x'.repeat(5000), code: 0, stderr: '' });
  const long = await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  assert.equal(long.ok, true);
  assert.ok(!long.reply.includes(GH), 'secrets are redacted from the reply');
  assert.ok(Buffer.byteLength(long.reply, 'utf8') <= SAY_HI_REPLY_BYTES + 3, 'the reply stops at 2 KB');
  fake.answer = () => ({ stdout: '', code: 1, stderr: 'Error: usage limit reached, try again at 2026-09-29 18:20' });
  const failed = await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'FAILED');
  assert.match(failed.reason, /usage limit reached, try again at 2026-09-29 18:20/, 'the reason is passed on as it came');
  assert.equal(failed.reply, '');
});

test('B0020-hotfix a failure reason strips terminal control codes (e.g. a spinner Ollama prints while pulling a model)', async () => {
  fake.answer = () => ({ stdout: '', code: 1, stderr: '\u001b[?2026h\u001b[?25l\u001b[1Gpulling manifest ⠙ \u001b[K\u001b[?25h\u001b[?2026lError: pull model manifest: file does not exist' });
  const failed = await H('agents:say-hi', { agentId: 'ollama', model: 'qwen3-coder:30b' });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /^pulling manifest.*Error: pull model manifest: file does not exist$/);
  assert.doesNotMatch(failed.reason, /[\u001b\u009b]/, 'no raw escape byte reaches the UI');
});

test('B0020-hotfix a spinner that reprints the same phrase many times (each frame separated by its own escape codes, already stripped) collapses to one', async () => {
  const { collapseRepeatedPhrases } = require('../electron/lib/agent-settings.cjs');
  const spammy = Array(6).fill('pulling manifest ☘').join(' ') + ' pulling manifest Error: pull model manifest: file does not exist';
  assert.equal(collapseRepeatedPhrases(spammy), 'pulling manifest Error: pull model manifest: file does not exist');
  assert.equal(collapseRepeatedPhrases('a single unrelated message'), 'a single unrelated message', 'ordinary text is untouched');
  fake.answer = () => ({ stdout: '', code: 1, stderr: Array(7).fill('pulling manifest ☙').join('') + 'Error: pull model manifest: file does not exist' });
  const failed = await H('agents:say-hi', { agentId: 'ollama', model: 'qwen3-coder:30b' });
  assert.equal((failed.reason.match(/pulling manifest/g) || []).length, 1, 'the spinner phrase appears only once in the reason shown to the person');
  assert.match(failed.reason, /Error: pull model manifest: file does not exist$/);
});

test('B0019 only one greeting per agent runs at a time', async () => {
  fake.delayMs = 250;
  const first = H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const second = await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'BUSY');
  assert.equal((await first).ok, true);
  assert.equal(fake.spawns.length, 1, 'the second request never started a process');
  fake.delayMs = 0;
  assert.equal((await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' })).ok, true, 'and the agent is free again afterwards');
});

test('B0019 an agent that is not installed, or has no model yet, is not called', async () => {
  fake.installed = new Set();
  const missing = await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  assert.equal(missing.code, 'NOT_INSTALLED');
  assert.equal(fake.spawns.length, 0);
  fake.installed = new Set(['ollama']);
  await H('agents:settings:set', { agentId: 'ollama', model: '' });
  const noModel = await H('agents:say-hi', { agentId: 'ollama' });
  assert.equal(noModel.code, 'NEEDS_MODEL');
  assert.equal(fake.spawns.length, 0);
});

test('B0019 Codex has no greeting of its own: the isolated workers are its path, and the official website has none at all', async () => {
  const codex = await H('agents:say-hi', { agentId: 'codex-cli' });
  assert.equal(codex.ok, false);
  assert.equal(codex.code, 'USE_WORKERS');
  await assert.rejects(() => H('agents:say-hi', { agentId: 'chatgpt-web' }), /Invalid IPC request/);
  assert.equal(fake.spawns.length, 0);
});

test('B0019 PEGA and OFFICIAL: refused without a key or a login, and when they run the sandbox stays workspace-write with the key only in the process environment', async () => {
  delete process.env[PEGA_ENV_KEY];
  await H('agents:settings:set', { agentId: 'codex-pega', model: 'Pega-Coding', effort: 'medium' });
  const noKey = await H('agents:say-hi', { agentId: 'codex-pega' });
  assert.equal(noKey.code, 'NO_KEY');
  const noLogin = await H('agents:say-hi', { agentId: 'codex-official' });
  assert.equal(noLogin.code, 'AUTH_REQUIRED');
  assert.equal(fake.spawns.length, 0, 'nothing runs without a key or a login');

  const view = await H('agents:settings:get');
  assert.equal(view.agents.find((agent) => agent.id === 'codex-pega').sayHi.keyConfigured, false);
  process.env[PEGA_ENV_KEY] = 'sk-live-PEGA-SECRET-VALUE-0123456789';
  fake.installed.add('codex');
  fake.answer = () => ({ stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"Hi from Codex"}}\n', code: 0, stderr: '' });
  const pega = await H('agents:say-hi', { agentId: 'codex-pega' });
  assert.equal(pega.ok, true);
  assert.equal(pega.reply, 'Hi from Codex');
  assert.ok(!JSON.stringify(pega).includes('PEGA-SECRET-VALUE'), 'the key is never in what the renderer receives');
  assert.equal(JSON.stringify(await H('agents:settings:get')).includes('PEGA-SECRET-VALUE'), false, 'nor in the settings view');
  const call = fake.spawns[0];
  assert.match(path.basename(call.command).toLowerCase(), /^codex(\.exe)?$/);
  assert.ok(call.args.includes('--skip-git-repo-check') && call.args.includes('workspace-write') && !call.args.includes('danger-full-access'));
  assert.equal(call.args.at(-1), SAY_HI_PROMPT);
  assert.equal(path.resolve(call.args[call.args.indexOf('--cd') + 1]), path.resolve(ctx.userData, 'say-hi', 'codex-pega'));
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'Pega-Coding');
  assert.equal(call.env[PEGA_ENV_KEY], 'sk-live-PEGA-SECRET-VALUE-0123456789', 'the child gets the key through its environment');
  const config = fs.readFileSync(path.join(ctx.userData, 'workers', 'codex-pega', 'codex-home', 'config.toml'), 'utf8');
  assert.ok(!config.includes('PEGA-SECRET-VALUE'));
  assert.match(config, /^model_reasoning_effort = "medium"$/m);
  assert.equal((await H('worker:list')).find((worker) => worker.id === 'codex-pega').runtimeState, 'IDLE', 'the worker is released afterwards');

  const home = path.join(ctx.userData, 'workers', 'codex-official', 'codex-home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'auth.json'), '{}');
  // With no model chosen, OFFICIAL still says hi: Codex picks its own default model and no --model is sent.
  // ("Reading additional input from stdin..." on stderr is a routine Codex notice, not a request for input.)
  fake.spawns.length = 0;
  const defaultModel = await H('agents:say-hi', { agentId: 'codex-official' });
  assert.equal(defaultModel.ok, true);
  assert.equal(fake.spawns.length, 1);
  assert.ok(!fake.spawns[0].args.includes('--model'), 'no model chosen: Codex uses its own default');
  await H('agents:settings:set', { agentId: 'codex-official', model: 'gpt-5.1-codex', effort: 'high' });
  fake.spawns.length = 0;
  const official = await H('agents:say-hi', { agentId: 'codex-official' });
  assert.equal(official.ok, true);
  assert.equal(official.agentName, 'Codex OFFICIAL (OpenAI Official)');
  assert.equal(fake.spawns[0].args[fake.spawns[0].args.indexOf('--model') + 1], 'gpt-5.1-codex');
  assert.match(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), /^model_reasoning_effort = "high"$/m);
  delete process.env[PEGA_ENV_KEY];
});

test('B0019 the service enforces the limits itself: fixed prompt, 60 second timeout, output limit, one at a time, no approval means no call', async () => {
  const seen = [];
  const service = new SayHiService({ execute: async (request) => { seen.push(request); return { code: 0, stdout: 'hi' }; } });
  assert.equal((await service.run({ agentId: 'ollama', model: 'm' })).ok, true);
  assert.equal(seen[0].prompt, SAY_HI_PROMPT);
  assert.equal(seen[0].timeoutMs, SAY_HI_TIMEOUT_MS);
  assert.equal(SAY_HI_TIMEOUT_MS, 60000);
  assert.ok(seen[0].maxOutputBytes > 0 && seen[0].maxOutputBytes <= 1024 * 1024);
  await assert.rejects(() => service.run({ agentId: 'ollama', model: 'bad model' }), /Model name/);
  await assert.rejects(() => service.run({ agentId: 'chatgpt-web' }), /Unsupported agent/);
  const outcome = (over) => new SayHiService({ execute: async () => over }).run({ agentId: 'ollama', model: 'm' });
  assert.equal((await outcome({ timedOut: true, code: -1 })).code, 'TIMEOUT');
  assert.equal((await outcome({ outputLimitExceeded: true, code: -1 })).code, 'OUTPUT_LIMIT');
  assert.equal((await outcome({ code: 0, stdout: '' })).code, 'EMPTY');
  const expired = '{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed","usage":{}}';
  const loggedOut = await outcome({ code: 0, stdout: expired });
  assert.equal(loggedOut.ok, false, 'an error a tool reports in its JSON is a failure even with exit code 0');
  assert.equal(loggedOut.reason, 'Failed to authenticate: OAuth session expired and could not be refreshed', 'and its own message is the reason');
  assert.equal((await outcome({ code: 1, stdout: expired })).reason, 'Failed to authenticate: OAuth session expired and could not be refreshed');
  const denied = await new SayHiService({ execute: async () => { throw Object.assign(new Error('network access requires approval'), { code: 'APPROVAL_REQUIRED' }); } }).run({ agentId: 'claude-code' });
  assert.equal(denied.code, 'APPROVAL_REQUIRED');
  assert.equal(denied.ok, false);
  let release;
  const slow = new SayHiService({ execute: () => new Promise((resolve) => { release = () => resolve({ code: 0, stdout: 'hi' }); }) });
  const running = slow.run({ agentId: 'ollama', model: 'm' });
  // A missing guard would start a second call that never finishes, so the answer is raced against a short timer instead of awaited.
  const second = await Promise.race([slow.run({ agentId: 'ollama', model: 'm' }), new Promise((resolve) => setTimeout(() => resolve({ code: 'STARTED_A_SECOND_CALL' }), 300))]);
  assert.equal(second.code, 'BUSY');
  release();
  assert.equal((await running).ok, true);
});

test('B0020-hotfix3 a structured error in the CLI\'s own JSON output wins over routine stderr status noise (Codex always writes to stderr once it starts)', async () => {
  fake.answer = () => ({
    stdout: [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.1-codex\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}'
    ].join('\n'),
    code: 1,
    stderr: 'Reading additional input from stdin...'
  });
  const failed = await H('agents:say-hi', { agentId: 'ollama', model: 'llama3.2:3b' });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /not supported when using Codex with a ChatGPT account/, 'the real, nested error is surfaced');
  assert.doesNotMatch(failed.reason, /Reading additional input from stdin/, 'routine status noise on stderr is not shown when a real error is available');
});

// What `ollama show` really prints for these models on the owner's machine (Capabilities section only).
const SHOW_NO_THINKING = '  Model\n    architecture qwen3moe\n\n  Capabilities\n    completion\n    tools\n\n  Parameters\n    top_k 20\n';
const SHOW_ON_OFF = '  Capabilities\n    completion\n    tools\n    thinking\n        levels     false, true\n        default    true\n\n';

test('B0020-hotfix2 Ollama gets no --think for a model that cannot think, and plain on for an on/off model, whatever level is saved', async () => {
  fake.models = ['qwen3-coder:30b', 'qwen3:14b'];
  fake.show = { 'qwen3-coder:30b': SHOW_NO_THINKING, 'qwen3:14b': SHOW_ON_OFF };
  await H('agents:settings:set', { agentId: 'ollama', model: 'qwen3-coder:30b', effort: 'high' });
  assert.equal((await H('agents:say-hi', { agentId: 'ollama' })).ok, true);
  assert.deepEqual(fake.spawns.at(-1).args, ['run', 'qwen3-coder:30b', SAY_HI_PROMPT], 'a model without thinking gets no --think at all');
  const view = await H('agents:settings:get');
  assert.deepEqual(view.ollamaThinking, { 'qwen3-coder:30b': [] }, 'the card is told this model cannot think');
  await H('agents:settings:set', { agentId: 'ollama', model: 'qwen3:14b', effort: 'high' });
  await H('agents:say-hi', { agentId: 'ollama' });
  assert.deepEqual(fake.spawns.at(-1).args, ['run', 'qwen3:14b', SAY_HI_PROMPT, '--think=true'], 'an on/off model is switched on instead of being sent a level it rejects');
  assert.deepEqual((await H('agents:settings:get')).ollamaThinking, { 'qwen3:14b': ['true'] });
  fake.models = ['qwen3:4b-instruct', 'llama3.2:3b'];
  fake.show = {};
  await H('agents:settings:set', { agentId: 'ollama', model: '', effort: '' });
});

test('B0020-hotfix2 the Codex OFFICIAL card lists the models Codex fetched for the account, from its own models_cache.json', async () => {
  const home = path.join(ctx.userData, 'workers', 'codex-official', 'codex-home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 12, default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }] },
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', priority: 1, default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }, { effort: 'ultra' }] },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43, supported_reasoning_levels: [] },
    { slug: 'bad id; calc', display_name: 'x', visibility: 'list', priority: 2, supported_reasoning_levels: [] }
  ] }));
  const view = await H('agents:settings:get');
  const official = view.agents.find((agent) => agent.id === 'codex-official');
  assert.deepEqual(official.knownModels, ['gpt-6-astra', 'gpt-5.5'], 'listed models only, in Codex priority order, unsafe ids dropped');
  assert.deepEqual(official.knownModelLabels, { 'gpt-6-astra': 'GPT-6-Astra', 'gpt-5.5': 'GPT-5.5' });
  assert.deepEqual(official.modelEfforts['gpt-6-astra'], ['low', 'max', 'ultra']);
  assert.equal(view.agents.find((agent) => agent.id === 'codex-cli').knownModels, undefined, 'the plain Codex CLI card is left as work order 0022 decided');
  const saved = await H('agents:settings:set', { agentId: 'codex-official', model: 'gpt-6-astra', effort: 'ultra' });
  assert.equal(saved.agents.find((agent) => agent.id === 'codex-official').effort, 'ultra', 'the real top levels of a model are accepted');
  assert.match(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), /^model_reasoning_effort = "ultra"$/m);
  fs.rmSync(path.join(home, 'models_cache.json'), { force: true });
});

test('B0020-hotfix2 greeting with a model other than the saved one uses that model own thinking support', async () => {
  fake.models = ['qwen3-coder:30b', 'qwen3:14b'];
  fake.show = { 'qwen3-coder:30b': SHOW_NO_THINKING, 'qwen3:14b': SHOW_ON_OFF };
  await H('agents:settings:set', { agentId: 'ollama', model: 'qwen3:14b', effort: 'high' });
  await H('agents:say-hi', { agentId: 'ollama', model: 'qwen3-coder:30b' });
  assert.deepEqual(fake.spawns.at(-1).args, ['run', 'qwen3-coder:30b', SAY_HI_PROMPT], 'the saved on/off model setting must not leak --think onto a model that cannot think');
  fake.models = ['qwen3:4b-instruct', 'llama3.2:3b'];
  fake.show = {};
  await H('agents:settings:set', { agentId: 'ollama', model: '', effort: '' });
});
