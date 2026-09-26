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
const fake = { spawns: [], execs: [], installed: new Set(['ollama']), models: ['qwen3:4b-instruct', 'llama3.2:3b'], answer: () => ({ stdout: 'Hello there!', code: 0, stderr: '' }), delayMs: 0 };
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
  setImmediate(() => cb(null, args[0] === 'list' ? table : `${command} version 9.9.9`, ''));
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
  assert.deepEqual(fake.spawns[0].args, ['run', '--think', 'low', 'qwen3:4b-instruct', SAY_HI_PROMPT]);
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
