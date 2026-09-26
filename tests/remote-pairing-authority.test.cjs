'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteGateway } = require('../electron/lib/remote-gateway.cjs');

async function startGateway(t) {
  const calls = { approve: [], reject: [] };
  const gateway = new RemoteGateway({
    status: async () => ({ runs: [], tasks: [], approvals: [] }),
    replay: async () => [],
    approve: async (id, meta) => { calls.approve.push({ id, meta }); return { id, state: 'APPROVED' }; },
    reject: async (id, meta) => { calls.reject.push({ id, meta }); return { id, state: 'REJECTED' }; }
  });
  const info = await gateway.start();
  t.after(async () => { gateway.server?.closeAllConnections?.(); await gateway.stop(); });
  const base = `http://127.0.0.1:${info.port}`;
  const request = async (method, pathname, token, headers = {}) => {
    const response = await fetch(base + pathname, { method, signal: AbortSignal.timeout(3000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const pair = async (scope, device) => {
    const started = await request('GET', `/pair/start?scope=${scope}`, info.token);
    assert.equal(started.status, 200);
    const claimed = await request('GET', `/pair/claim?code=${started.body.code}&device=${device}`);
    assert.equal(claimed.status, 200);
    return claimed.body;
  };
  return { gateway, info, calls, request, pair };
}

const REQUEST_ID = { 'x-aecp-request-id': 'request-id-12345678' };

test('R6.4 a READ_ONLY paired device can read but cannot approve, reject, or perform any other action', async (t) => {
  const { info, calls, request, pair } = await startGateway(t);
  const device = await pair('READ_ONLY', 'phone-read');
  assert.equal(device.scope, 'READ_ONLY');

  assert.equal((await request('GET', '/api/status', device.token)).status, 200);

  for (const action of ['approve', 'reject']) {
    const denied = await request('POST', `/api/approvals/appr-1/${action}`, device.token, REQUEST_ID);
    assert.equal(denied.status, 403, `READ_ONLY must not ${action}`);
  }
  for (const [method, pathname] of [['POST', '/api/merge'], ['POST', '/api/tasks'], ['POST', '/api/execute'], ['POST', '/api/credentials'], ['POST', '/api/system'], ['POST', '/api/approvals/appr-1/merge'], ['PUT', '/api/tasks'], ['DELETE', '/api/tasks']]) {
    const denied = await request(method, pathname, device.token, REQUEST_ID);
    assert.ok([403, 405].includes(denied.status), `${method} ${pathname} must be refused (got ${denied.status})`);
  }
  assert.equal(calls.approve.length + calls.reject.length, 0, 'no privileged callback may run for a READ_ONLY device');

  assert.equal((await request('GET', '/api/devices', device.token)).status, 403, 'a paired device cannot list or manage devices');
  assert.equal((await request('GET', '/pair/start?scope=APPROVAL_ONLY', device.token)).status, 401, 'a paired device cannot mint new pairings');
  assert.equal(info.remoteActions, 'approval-only');
});

test('R6.4 an APPROVAL_ONLY device can only approve or reject and gains no write, execute, merge, credential or system endpoint', async (t) => {
  const { calls, request, pair } = await startGateway(t);
  const device = await pair('APPROVAL_ONLY', 'phone-approve');

  const approved = await request('POST', '/api/approvals/appr-9/approve', device.token, REQUEST_ID);
  assert.equal(approved.status, 200);
  assert.deepEqual(calls.approve.map((call) => [call.id, call.meta.scope, call.meta.deviceId]), [['appr-9', 'APPROVAL_ONLY', 'phone-approve']]);
  assert.equal((await request('POST', '/api/approvals/appr-9/reject', device.token, REQUEST_ID)).status, 200);
  assert.equal((await request('POST', '/api/approvals/appr-9/approve', device.token)).status, 400, 'a replay-safe request id is mandatory');

  const before = calls.approve.length + calls.reject.length;
  for (const pathname of ['/api/merge', '/api/tasks', '/api/execute', '/api/credentials', '/api/system', '/api/approvals/appr-9/merge']) {
    const denied = await request('POST', pathname, device.token, REQUEST_ID);
    assert.equal(denied.status, 405, `${pathname} must not exist for remote actions`);
  }
  assert.equal(calls.approve.length + calls.reject.length, before);
  assert.equal((await request('GET', '/api/devices', device.token)).status, 403);
  assert.equal((await request('GET', '/pair/start?scope=READ_ONLY', device.token)).status, 401);
});

test('R6.4 pairing can only ever create the two non-privileged scopes', async (t) => {
  const { info, request } = await startGateway(t);
  for (const scope of ['WRITE', 'EXECUTE', 'MERGE', 'CREDENTIAL', 'SYSTEM', 'ADMIN', 'ALL', '*']) {
    const refused = await request('GET', `/pair/start?scope=${encodeURIComponent(scope)}`, info.token);
    assert.equal(refused.status, 400, `scope ${scope} must be refused`);
    assert.match(refused.body.error, /Unsupported pairing scope/);
  }
  assert.equal((await request('GET', '/pair/start?scope=READ_ONLY', info.token)).status, 200);
  assert.equal((await request('GET', '/pair/start?scope=APPROVAL_ONLY', info.token)).status, 200);
  assert.equal((await request('GET', '/pair/start?scope=READ_ONLY')).status, 401, 'pairing needs the local bootstrap token');
});

test('R6.4 a revoked device loses all access immediately', async (t) => {
  const { gateway, request, pair } = await startGateway(t);
  const device = await pair('APPROVAL_ONLY', 'lost-phone');
  assert.equal((await request('GET', '/api/status', device.token)).status, 200);
  assert.equal(gateway.revokeDeviceId('lost-phone'), true);
  assert.equal((await request('GET', '/api/status', device.token)).status, 401);
  assert.equal((await request('POST', '/api/approvals/appr-1/approve', device.token, REQUEST_ID)).status, 401);
});
