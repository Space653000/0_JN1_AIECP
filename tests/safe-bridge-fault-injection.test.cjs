'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');

const KEY = 'fault-injection-secret-key-987654';
const ctx = loadMain();
const fetchUrls = [];
const realFetch = global.fetch;
global.fetch = (input, ...rest) => { fetchUrls.push(String(input?.url || input)); return realFetch(input, ...rest); };
let workspace;

const p = (...parts) => path.join(ctx.userData, ...parts);

// The whole Web Safe Bridge round trip: sample card, import, execute read-only, list, and opening the official ChatGPT.
async function safeBridge(label, { backgroundProviderTraffic = null } = {}) {
  const fetchesBefore = fetchUrls.length;
  const openedBefore = ctx.record.openExternal.length;
  const card = await ctx.handlers['task:sample']({});
  const imported = await ctx.handlers['task:import']({}, { text: JSON.stringify(card) });
  assert.equal(imported.state, 'READY', label);
  await ctx.handlers['task:execute']({}, { taskId: imported.id });
  const finished = (await ctx.handlers['task:list']({})).find((task) => task.id === imported.id);
  assert.equal(finished.state, 'DONE', `${label}: the Safe Bridge task completes`);
  assert.equal(finished.result.status, 'PASS', label);
  assert.equal(await ctx.handlers['chatgpt:open']({}), true, `${label}: the official ChatGPT surface still opens`);
  assert.deepEqual(ctx.record.openExternal.slice(openedBefore), ['https://chatgpt.com/']);
  const unexpected = fetchUrls.slice(fetchesBefore).filter((url) => !(backgroundProviderTraffic && backgroundProviderTraffic.test(url)));
  assert.deepEqual(unexpected, [], `${label}: the Safe Bridge makes no network request of its own`);
}

const health = (providerId, extra = {}) => ctx.handlers['provider:health']({}, { providerId, networkApproved: true, credentialApproved: true, timeoutMs: 1500, ...extra });

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-bridge-fault-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'safe bridge fault injection\n');
  await ctx.start();
  ctx.control.chosenFolder = workspace;
  await ctx.handlers['workspace:select']({});
});
test.after(() => {
  global.fetch = realFetch;
  fs.rmSync(workspace, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('R3.6 the Web Safe Bridge keeps working through every optional-provider failure mode, one after another', async () => {
  await safeBridge('baseline');

  const dead = await ctx.handlers['provider:save']({}, { name: 'Dead API', kind: 'api', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'm', apiKey: KEY });
  assert.equal((await health(dead.id)).status, 'UNAVAILABLE');
  assert.equal((await health(dead.id, { networkApproved: false })).status, 'DEGRADED');
  await safeBridge('unreachable API provider');

  const mcp = await ctx.handlers['provider:save']({}, { name: 'Dead MCP', kind: 'remote-mcp', baseUrl: 'http://127.0.0.1:1/mcp' });
  assert.equal((await health(mcp.id)).status, 'UNAVAILABLE');
  await safeBridge('unreachable remote MCP provider');

  const unconfigured = { official: await health('openai-official'), pega: await health('pega') };
  for (const [name, result] of Object.entries(unconfigured)) assert.ok(['AUTH_REQUIRED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'DEGRADED'].includes(result.status), `${name}: ${result.status}`);
  assert.equal((await health('not-a-provider')).status, 'NOT_CONFIGURED');
  await safeBridge('unconfigured OFFICIAL/PEGA workers');

  const stateFile = p('state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.providers.push({ id: 'junk-provider', kind: 'no-such-kind', name: 42, roles: 'not-an-array' });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  await safeBridge('a malformed provider record in state.json');

  fs.writeFileSync(p('credentials.json'), '{ this is not json');
  ctx.control.encryptionAvailable = false;
  await assert.rejects(ctx.handlers['provider:save']({}, { name: 'Late key', kind: 'api', baseUrl: 'https://api.example.com/v1', defaultModel: 'm', apiKey: KEY }), /encryption is unavailable/);
  await safeBridge('a corrupted credential store with OS encryption unavailable');

  assert.ok((await ctx.handlers['task:list']({})).length >= 6, 'every Safe Bridge task was recorded');
});

test('R3.10 a Control Plane mission that fails on an unavailable provider leaves the Web Safe Bridge untouched', async () => {
  ctx.control.encryptionAvailable = true;
  fs.writeFileSync(p('credentials.json'), JSON.stringify({ schemaVersion: 1, values: {} }));
  const dead = await ctx.handlers['provider:save']({}, { name: 'Mission API', kind: 'api', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'm', apiKey: KEY });
  fs.rmSync(p('workers'), { recursive: true, force: true });

  const failure = await ctx.handlers['control-plane:create-mission']({}, {
    goal: 'A mission whose planner endpoint is down', done: 'It is never reached.', providers: { planner: dead.id, builder: 'codex', reviewer: dead.id }, providerApprovals: { network: true, credential: true }, maxIterations: 2, maxTurns: 10, maxFailedAttempts: 2
  }).then(() => null, (error) => error);
  assert.ok(failure, 'the mission cannot start without its planner');
  assert.doesNotMatch(String(failure.message), new RegExp(KEY));
  const background = /^http:\/\/127\.0\.0\.1:1\//;
  await safeBridge('a failed Control Plane mission', { backgroundProviderTraffic: background });

  const status = await ctx.handlers['control-plane:status']({});
  assert.ok(status.runs === undefined || typeof status === 'object');
  await safeBridge('after reading the Control Plane status', { backgroundProviderTraffic: background });
});
