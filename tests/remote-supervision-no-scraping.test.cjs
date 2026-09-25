'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { RemoteGateway } = require('../electron/lib/remote-gateway.cjs');
const { WindowsUiAdapter } = require('../electron/lib/windows-ui-adapter.cjs');
const { IPC_SCHEMAS, validatePayload } = require('../electron/lib/ipc-validation.cjs');

// Every TCP connection attempt made in this process, whoever makes it.
const attempts = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  attempts.push(typeof first === 'object' && first !== null ? { host: first.host || first.path || '', port: first.port } : { host: String(args[1] || ''), port: first });
  return realConnect.apply(this, args);
};
test.after(() => { net.Socket.prototype.connect = realConnect; });

let canonical = {
  schema: 'aecp.control-plane/v1', runs: [{ id: 'mission-1', state: 'RUNNING', goal: 'canonical goal' }],
  tasks: [{ id: 'task-1', state: 'RUNNING' }], approvals: [{ id: 'appr-1', state: 'WAITING', reason: 'push needs a human' }]
};
const ledger = [{ id: 'evt-1', type: 'task.claimed' }, { id: 'evt-2', type: 'approval.requested' }];

async function startGateway(t) {
  const gateway = new RemoteGateway({ status: async () => canonical, replay: async () => ledger, approve: async () => ({}), reject: async () => ({}) });
  const info = await gateway.start();
  t.after(async () => { gateway.server?.closeAllConnections?.(); await gateway.stop(); });
  const request = async (pathname, token) => {
    const response = await fetch(`http://127.0.0.1:${info.port}${pathname}`, { signal: AbortSignal.timeout(3000), headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const started = await request('/pair/start?scope=READ_ONLY', info.token);
  const device = (await request(`/pair/claim?code=${started.body.code}&device=phone`)).body;
  return { info, request, device };
}

test('B16-L335 remote supervision is served from AECP canonical state and event ledger, and follows them exactly', async (t) => {
  const { request, device } = await startGateway(t);
  assert.deepEqual((await request('/api/status', device.token)).body, canonical);
  assert.deepEqual((await request('/api/approvals', device.token)).body, { approvals: canonical.approvals });
  assert.deepEqual((await request('/api/runs', device.token)).body, { runs: canonical.runs });
  assert.deepEqual((await request('/api/tasks', device.token)).body, { tasks: canonical.tasks });
  assert.deepEqual((await request('/api/events', device.token)).body, ledger);
  canonical = { ...canonical, approvals: [], runs: [{ id: 'mission-1', state: 'DONE', goal: 'canonical goal' }] };
  assert.deepEqual((await request('/api/approvals', device.token)).body, { approvals: [] }, 'a change in AECP state is what the phone sees; nothing else feeds it');
  assert.equal((await request('/api/runs', device.token)).body.runs[0].state, 'DONE');
});

test('B16-L335 the gateway has no route that could read a ChatGPT conversation or page', async (t) => {
  const { request, device } = await startGateway(t);
  for (const pathname of ['/api/chatgpt', '/api/conversation', '/api/conversations', '/api/scrape', '/api/page', '/api/browser', '/api/session', '/backend-api/conversations', '/api/proxy?url=https://chatgpt.com/']) {
    const reply = await request(pathname, device.token);
    assert.ok([403, 404].includes(reply.status), `${pathname} -> ${reply.status}`);
  }
  assert.equal((await request('/api/status')).status, 401, 'and nothing is served without a pairing');
});

test('B16-L335 serving remote supervision opens no connection except to the paired device', async (t) => {
  const { info, request, device } = await startGateway(t);
  attempts.length = 0;
  // A fresh connection per request (no keep-alive), so every connection attempt is visible to the spy.
  const fresh = (pathname) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: info.port, path: pathname, agent: false, headers: { authorization: `Bearer ${device.token}`, connection: 'close' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  for (const pathname of ['/health', '/api/status', '/api/runs', '/api/tasks', '/api/approvals', '/api/events']) assert.equal(await fresh(pathname), 200, pathname);
  void request;
  assert.ok(attempts.length > 0, 'the spy really sees the test client connections');
  for (const attempt of attempts) {
    assert.ok(['127.0.0.1', 'localhost', '::1', ''].includes(attempt.host), `unexpected outbound host ${attempt.host}`);
    assert.equal(Number(attempt.port), info.port, 'only the gateway port is ever connected to');
  }
  assert.ok(!attempts.some((attempt) => /chatgpt|openai/i.test(attempt.host)));
});

test('B16-L335 the desktop adapter refuses to read a browser window (where ChatGPT lives) and the IPC cannot enable it', async () => {
  const adapter = new WindowsUiAdapter();
  let ranTree = false;
  adapter.listWindows = async () => [{ pid: 4242, processName: 'chrome', title: 'ChatGPT', browser: true }, { pid: 7, processName: 'Code', browser: false }];
  await assert.rejects(() => adapter.inspect(4242), /never inspects ChatGPT\/browser DOM/);
  await assert.rejects(() => adapter.inspect(4242, { allowBrowser: false }), /never inspects ChatGPT\/browser DOM/);
  assert.equal(ranTree, false);
  const schema = IPC_SCHEMAS['desktop:inspect-ui'];
  assert.ok(schema, 'the inspect channel has a validation schema');
  assert.throws(() => validatePayload('desktop:inspect-ui', schema, { pid: 4242, allowBrowser: true }), /Invalid IPC request/, 'a renderer cannot ask for browser inspection');
  assert.doesNotThrow(() => validatePayload('desktop:inspect-ui', schema, { pid: 7, maxNodes: 50 }));
});
