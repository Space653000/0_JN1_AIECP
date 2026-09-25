'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ProviderRouter } = require('../electron/lib/provider-router.cjs');
const { loadMain } = require('./support/fake-electron-main.cjs');

const API_KEY = 'health-probe-secret-key-123456';
const ctx = loadMain();
let fetchCount = 0;
const realFetch = global.fetch;
global.fetch = (...args) => { fetchCount += 1; return realFetch(...args); };

async function endpoint(handler) {
  const requests = [];
  const server = http.createServer((req, res) => { requests.push({ url: req.url, authorization: req.headers.authorization }); handler(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { requests, port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

test('B03-L129 fixed CLI and local-command health checks only run the tool version probe and never see task text', async () => {
  const calls = [];
  const runner = async (command, args, opts = {}) => { calls.push({ command: path.basename(String(command)), args: [...args], opts }); return { code: 0, stdout: 'tool 1.0.0', stderr: '', timedOut: false, aborted: false }; };
  const router = new ProviderRouter({
    cli: { mode: 'cli', command: 'claude', roles: ['planner'] },
    local: { mode: 'ollama', command: 'ollama', roles: ['planner'], defaultModel: 'llama3' },
    worker: { mode: 'codex-cli', command: 'codex', roles: ['builder'], codexHome: path.join(os.tmpdir(), 'home') },
    fixed: { mode: 'local-command', command: 'node', args: ['worker.cjs'], roles: ['builder'] }
  }, { runner, platform: 'linux' });

  for (const id of ['cli', 'local', 'worker', 'fixed']) {
    const result = await router.health(id, { model: 'TASK TEXT: delete everything' });
    assert.equal(result.status, 'READY', `${id}: ${result.detail}`);
  }
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.ok(JSON.stringify(call.args) === '["--version"]' || JSON.stringify(call.args) === '["node"]', `only fixed probe arguments: ${JSON.stringify(call.args)}`);
    assert.doesNotMatch(JSON.stringify(call.args), /TASK TEXT|delete/i);
  }

  const failing = new ProviderRouter({ broken: { mode: 'cli', command: 'claude', roles: ['planner'] }, thrower: { mode: 'ollama', command: 'ollama', roles: ['planner'], defaultModel: 'm' } }, {
    runner: async (command) => { if (command === 'ollama') throw new Error('spawn ollama ENOENT'); return { code: 127, stdout: '', stderr: 'not found', timedOut: false, aborted: false }; }
  });
  assert.equal((await failing.health('broken')).status, 'UNAVAILABLE');
  assert.equal((await failing.health('thrower')).status, 'UNAVAILABLE', 'a crashing probe becomes a state, never an exception');
  assert.equal((await failing.health('nope')).status, 'NOT_CONFIGURED');
  const noModel = new ProviderRouter({ o: { mode: 'ollama', command: 'ollama', roles: ['planner'] } }, { runner });
  assert.equal((await noModel.health('o')).status, 'DEGRADED');
});

test('B03-L129 live API probes need explicit NETWORK and CREDENTIAL approval, never use them silently, and stay bounded', async (t) => {
  const server = await endpoint((req, res) => {
    if (req.url.startsWith('/v1/slow')) return;
    const status = req.url.startsWith('/v1/denied') ? 401 : (req.url.startsWith('/v1/broken') ? 500 : 200);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end('{}');
  });
  t.after(async () => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const router = new ProviderRouter({
    keyed: { mode: 'openai-compatible', baseUrl: `${base}/v1`, defaultModel: 'm', roles: ['planner'], apiKey: API_KEY, network: true, credential: true },
    keyless: { mode: 'openai-compatible', baseUrl: `${base}/v1`, defaultModel: 'm', roles: ['planner'], network: true },
    denied: { mode: 'openai-compatible', baseUrl: `${base}/v1`, modelsPath: 'denied', defaultModel: 'm', roles: ['planner'], apiKey: API_KEY },
    broken: { mode: 'openai-compatible', baseUrl: `${base}/v1`, modelsPath: 'broken', defaultModel: 'm', roles: ['planner'], network: true },
    slow: { mode: 'openai-compatible', baseUrl: `${base}/v1`, modelsPath: 'slow', defaultModel: 'm', roles: ['planner'], network: true },
    dead: { mode: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'm', roles: ['planner'], network: true },
    mcp: { mode: 'remote-mcp', baseUrl: `${base}/mcp`, roles: [] },
    nomodel: { mode: 'openai-compatible', baseUrl: `${base}/v1`, roles: ['planner'] }
  });

  const unapproved = await router.health('keyed');
  assert.equal(unapproved.status, 'DEGRADED');
  assert.match(unapproved.detail, /NETWORK approval/);
  assert.equal((await router.health('keyless')).status, 'DEGRADED');
  const noCredential = await router.health('keyed', { networkApproved: true });
  assert.equal(noCredential.status, 'AUTH_REQUIRED', 'a stored credential is not used without CREDENTIAL approval');
  assert.equal(server.requests.length, 0, 'no live request was made without approval');

  const ready = await router.health('keyed', { networkApproved: true, credentialApproved: true });
  assert.equal(ready.status, 'READY');
  assert.deepEqual(server.requests.map((request) => [request.url, request.authorization]), [['/v1/models', `Bearer ${API_KEY}`]]);
  assert.equal((await router.health('keyless', { networkApproved: true })).status, 'READY');
  assert.equal(server.requests[1].authorization, undefined, 'a keyless provider sends no credential');
  assert.equal((await router.health('denied', { networkApproved: true, credentialApproved: true })).status, 'AUTH_REQUIRED');
  assert.equal((await router.health('broken', { networkApproved: true })).status, 'DEGRADED');
  assert.equal((await router.health('dead', { networkApproved: true })).status, 'UNAVAILABLE');
  assert.equal((await router.health('mcp', { networkApproved: true })).status, 'READY');
  assert.equal((await router.health('nomodel', { networkApproved: true })).status, 'NOT_CONFIGURED');

  const started = Date.now();
  const timedOut = await router.health('slow', { networkApproved: true, timeoutMs: 1000 });
  assert.equal(timedOut.status, 'UNAVAILABLE');
  assert.match(timedOut.detail, /timed out/);
  assert.ok(Date.now() - started < 4000, 'a hanging endpoint cannot block a health check for long');
});

const safeBridgeFlow = async () => {
  const card = await ctx.handlers['task:sample']({});
  const task = await ctx.handlers['task:import']({}, { text: JSON.stringify(card) });
  assert.equal(task.state, 'READY');
  const executed = await ctx.handlers['task:execute']({}, { taskId: task.id });
  const finished = (await ctx.handlers['task:list']({})).find((item) => item.id === task.id);
  return { task: finished, executed };
};

test('B03-L129 the Safe Bridge keeps working while optional providers are unreachable, misconfigured or the credential store is broken', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-safebridge-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'safe bridge workspace\n');
  await ctx.start();
  ctx.control.chosenFolder = workspace;
  await ctx.handlers['workspace:select']({});

  const healthy = await safeBridgeFlow();
  assert.equal(healthy.task.state, 'DONE');
  assert.equal(healthy.task.result.status, 'PASS');

  // Optional providers that cannot work: a dead endpoint with a stored key, and a broken credential store.
  const dead = await ctx.handlers['provider:save']({}, { name: 'Dead API', kind: 'api', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'm', apiKey: API_KEY });
  const health = await ctx.handlers['provider:health']({}, { providerId: dead.id, networkApproved: true, credentialApproved: true });
  assert.equal(health.status, 'UNAVAILABLE');
  const missing = await ctx.handlers['provider:health']({}, { providerId: 'never-registered' });
  assert.equal(missing.status, 'NOT_CONFIGURED');
  fs.writeFileSync(path.join(ctx.userData, 'credentials.json'), '{ this is not json');
  ctx.control.encryptionAvailable = false;
  await assert.rejects(ctx.handlers['provider:list']({}), undefined, 'the broken optional provider store fails on its own');

  const fetchesBefore = fetchCount;
  const openedBefore = ctx.record.openExternal.length;
  const degraded = await safeBridgeFlow();
  assert.equal(degraded.task.state, 'DONE', 'the Safe Bridge still completes its task');
  assert.equal(degraded.task.result.status, 'PASS');
  assert.equal(await ctx.handlers['chatgpt:open']({}), true, 'opening the official ChatGPT surface still works');
  assert.deepEqual(ctx.record.openExternal.slice(openedBefore), ['https://chatgpt.com/']);
  assert.equal(fetchCount, fetchesBefore, 'the Safe Bridge makes no network request of its own');
  assert.ok((await ctx.handlers['task:list']({})).length >= 2);
});

test.after(() => {
  global.fetch = realFetch;
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});
