'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createValidatedIpc, IPC_SCHEMAS, IpcValidationError, MAX_PAYLOAD_BYTES } = require('../electron/lib/ipc-validation.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');

function registeredChannels() {
  return [...main.matchAll(/\bipc\.handle\('([^']+)'/g)].map(m => m[1]);
}

function harness(schemas = IPC_SCHEMAS, options) {
  const handlers = new Map();
  const calls = [];
  const fakeIpcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const ipc = createValidatedIpc(fakeIpcMain, schemas, options);
  const register = (channel) => ipc.handle(channel, async (_event, payload) => { calls.push({ channel, payload }); return 'ok'; });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { register, invoke, calls, handlers };
}

test('B04-ELECTRON-L33 every registered IPC channel declares a validation schema and none bypasses the wrapper', () => {
  const channels = registeredChannels();
  assert.ok(channels.length >= 70, `expected the full channel set, found ${channels.length}`);
  assert.equal([...main.matchAll(/\bipcMain\.(handle|on|once|handleOnce)\(/g)].length, 0, 'no channel may bypass the validated wrapper');
  assert.match(main, /createValidatedIpc\(ipcMain, IPC_SCHEMAS/);
  // The wrapper must be declared inside registerIpc before its first use (node --check cannot see an undeclared variable).
  const fnStart = main.indexOf('function registerIpc() {');
  const declaration = main.indexOf('const ipc = createValidatedIpc(', fnStart);
  const firstUse = main.indexOf('ipc.handle(', fnStart);
  assert.ok(fnStart >= 0 && declaration > fnStart, 'ipc wrapper is declared inside registerIpc');
  assert.ok(firstUse > declaration, 'the wrapper is declared before the first ipc.handle');
  assert.equal(new Set(channels).size, channels.length, 'no duplicate channel registrations');
  const missing = channels.filter(channel => !IPC_SCHEMAS[channel]);
  assert.deepEqual(missing, []);
  const unused = Object.keys(IPC_SCHEMAS).filter(channel => !channels.includes(channel));
  assert.deepEqual(unused, [], 'schema table has no stale channels');
});

test('B04-ELECTRON-L33 registering a channel without a schema fails fast', () => {
  const { register } = harness({});
  assert.throws(() => register('made-up:channel'), /no validation schema/);
});

test('B04-ELECTRON-L33 the preload bridge only calls channels that have schemas', () => {
  const called = [...preload.matchAll(/call\('([^']+)'/g)].map(m => m[1])
    .concat([...preload.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]));
  assert.ok(called.length >= 70);
  const undeclared = called.filter(channel => !IPC_SCHEMAS[channel]);
  assert.deepEqual(undeclared, []);
});

const malformed = [
  ['control-plane:approve-delivery', undefined],
  ['control-plane:approve-delivery', null],
  ['control-plane:approve-delivery', 'run_1'],
  ['control-plane:approve-delivery', { runId: 'run_1' }],
  ['control-plane:approve-delivery', { runId: 'run_1', taskId: '../../x' }],
  ['control-plane:approve-delivery', { runId: 'run_1', taskId: 'T1', extra: true }],
  ['control-plane:approve-delivery', { runId: { toString: 'x' }, taskId: 'T1' }],
  ['control-plane:approve', { approvalId: 'a'.repeat(200) }],
  ['control-plane:cancel', { runId: '' }],
  ['control-plane:cancel-task', { runId: 'run_1', taskId: 'T1\\..\\..' }],
  ['control-plane:remote-revoke', { deviceId: 12 }],
  ['task:trace', { taskId: '..' }],
  ['task:trace', { taskId: '..\\..\\Windows\\win' }],
  ['task:evidence', { taskId: '../../secrets' }],
  ['task:evidence', { taskId: '' }],
  ['task:execute', { taskId: 'a/b' }],
  ['clipboard:write', { text: 'x'.repeat(128 * 1024 + 1) }],
  ['clipboard:write', { text: 123 }],
  ['clipboard:write', { text: 'ok', extra: 1 }],
  ['agents:launch', { agentId: 'cmd; calc' }],
  ['desktop:dock-browser', { pid: 'abc', side: 'left' }],
  ['desktop:dock-browser', { pid: 4, side: 'up' }],
  ['desktop:inspect-ui', { pid: -1 }],
  ['provider:delete', { providerId: '../x' }],
  ['provider:health', { providerId: 'p1', networkApproved: 'yes' }],
  ['policy:save', { maxRisk: 'EXTREME' }],
  ['policy:save', { maxRisk: 'GREEN', requireApprovalFor: 'WRITE' }],
  ['harness:start', { goal: 'g', sourceRoot: 'C:\\Windows' }],
  ['harness:start', { goal: 'g', executionApproved: true }],
  ['harness:start', { goal: 'g', providerRouter: {} }],
  ['harness:start', JSON.parse('{"goal":"g","__proto__":{"polluted":true}}')],
  ['harness:start', 'not an object'],
  ['control-plane:create-mission', { goal: 'g', done: 'd', permissionPolicy: { highRisk: 'AUTO' } }],
  ['control-plane:create-mission', { goal: 'g' }],
  ['control-plane:create-mission', { goal: 'g', done: 'd', maxTurns: 'lots' }],
  ['autonomy:start', { goal: 'g', done: 'd', runRoot: 'C:\\x' }],
  ['autonomy:start', { goal: 'g' }],
  ['provider:save', { name: 'n' }],
  ['task:import', { text: 'x'.repeat(70 * 1024) }],
  ['workspace:select', { path: 'C:\\' }],
  ['data:reset-state', { confirm: true }],
  ['mcp:start', 'unexpected']
];

for (const [channel, payload] of malformed) {
  test(`B04-ELECTRON-L33 malformed payload is rejected and the handler is not called: ${channel} ${JSON.stringify(payload)?.slice(0, 60)}`, async () => {
    const h = harness();
    h.register(channel);
    await assert.rejects(() => h.invoke(channel, payload), IpcValidationError);
    assert.equal(h.calls.length, 0);
  });
}

test('B04-ELECTRON-L33 rejected requests never echo the payload back in the error', async () => {
  const h = harness();
  h.register('control-plane:cancel');
  await assert.rejects(() => h.invoke('control-plane:cancel', { runId: 'SECRET-TOKEN-VALUE-!!' }), (error) => {
    assert.ok(error instanceof IpcValidationError);
    assert.doesNotMatch(error.message + JSON.stringify(error), /SECRET-TOKEN-VALUE/);
    return true;
  });
});

test('B04-ELECTRON-L33 extra positional arguments and oversized payloads are rejected', async () => {
  const h = harness();
  h.register('control-plane:start');
  h.register('provider:save');
  await assert.rejects(() => h.invoke('control-plane:start', { runId: 'run_1' }, { extra: 1 }), IpcValidationError);
  const big = { name: 'n', kind: 'k', notes: ['x'.repeat(60 * 1024), 'y'.repeat(60 * 1024), 'z'.repeat(60 * 1024), 'w'.repeat(60 * 1024), 'v'.repeat(60 * 1024)] };
  assert.ok(Buffer.byteLength(JSON.stringify(big)) > MAX_PAYLOAD_BYTES);
  await assert.rejects(() => h.invoke('provider:save', big), IpcValidationError);
  assert.equal(h.calls.length, 0);
});

const valid = [
  ['app:info', undefined], ['state:get', undefined], ['control-plane:status', null],
  ['guidance:recommend', { chatgptOpened: true }], ['guidance:recommend', undefined],
  ['policy:save', { maxRisk: 'YELLOW', requireApprovalFor: ['WRITE', 'INSTALL'] }],
  ['control-plane:start', { runId: 'run_1a2b3c' }], ['control-plane:pause', { runId: 'run_1' }],
  ['control-plane:cancel-task', { runId: 'run_1', taskId: 'T1' }],
  ['control-plane:approve', { approvalId: 'appr_1', note: undefined }],
  ['control-plane:approve-delivery', { runId: 'run_1', taskId: 'T1', by: 'human' }],
  ['control-plane:events', { limit: 300 }], ['control-plane:replay', { runId: 'run_1', limit: 50 }],
  ['control-plane:remote-revoke', { deviceId: 'dev_ab12' }],
  ['harness:start', { goal: 'Goal', done: 'Done', maxTasks: 4, maxWallClockMs: 3600000, maxProviderReportedCost: null, plannerModel: null, providerNetworkApproved: false }],
  ['control-plane:create-mission', { goal: 'g', done: 'd', builderWorkers: ['codex-official'], maxConcurrency: 2, maxPatchBytes: 67108864, maxProviderReportedCost: null, delivery: false, autoStart: true }],
  ['autonomy:start', { goal: 'g', done: 'd', workerId: 'opencode', verificationProfile: 'npm-test', maxIterations: 4, iterationTimeoutSeconds: 300, checkpointEvery: 1 }],
  ['agents:launch', { agentId: 'claude-code' }],
  ['desktop:inspect-ui', { pid: 4242, maxNodes: 120 }], ['desktop:dock-browser', { pid: 4242, side: 'left' }],
  ['clipboard:write', { text: '繁體中文 result capsule' }], ['task:import', { text: '{"schema":"aecp.task/v1"}' }],
  ['task:execute', { taskId: 'task_abc-1' }], ['task:trace', { taskId: 'task_abc-1' }], ['task:evidence', { taskId: 'task_abc-1' }],
  ['provider:health', { providerId: 'openai-official', networkApproved: false }],
  ['provider:save', { name: 'Local', kind: 'ollama', baseUrl: '', defaultModel: 'llama3', wireApi: 'responses', command: 'ollama', args: '', apiKey: '' }],
  ['provider:delete', { providerId: 'my-provider.1' }]
];

for (const [channel, payload] of valid) {
  test(`B04-ELECTRON-L33 the legitimate call shape used by the UI still passes: ${channel}`, async () => {
    const h = harness();
    h.register(channel);
    assert.equal(await h.invoke(channel, payload), 'ok');
    assert.equal(h.calls.length, 1);
  });
}

test('B04-ELECTRON-L33 a sender that is not the packaged UI is rejected before any validation or handler', async () => {
  const h = harness(IPC_SCHEMAS, { senderAllowed: (event) => event?.senderFrame?.url === 'file:///ui/index.html' });
  h.register('control-plane:status');
  h.handlers.get('control-plane:status')({ senderFrame: { url: 'file:///ui/index.html' } });
  await assert.rejects(() => h.handlers.get('control-plane:status')({ senderFrame: { url: 'https://evil.example/' } }), IpcValidationError);
  assert.equal(h.calls.length, 1);
});
