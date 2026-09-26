'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { GitHubWebhookReceiver } = require('../electron/lib/github-webhook.cjs');

const SECRET = 'dispatch-secret';
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

async function receive(t, event, payload) {
  const seen = [];
  const receiver = new GitHubWebhookReceiver({ secret: SECRET, onEvent: async (e) => { seen.push(e); } });
  const { port } = await receiver.start();
  t.after(() => receiver.stop());
  const body = JSON.stringify(payload);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/github/webhook', method: 'POST', headers: { 'x-hub-signature-256': sign(body), 'x-github-event': event, 'x-github-delivery': 'd-' + Math.random().toString(16).slice(2) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.setTimeout(3000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
  return { status, seen };
}

test('B05-L118 a repository_dispatch carrying a versioned AECP event is correlated by its correlation id', async (t) => {
  const { status, seen } = await receive(t, 'repository_dispatch', { action: 'aecp-run', client_payload: { schema: 'aecp.event/v1', correlationId: 'run-42', type: 'run.requested' } });
  assert.equal(status, 202);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].eventType, 'repository_dispatch');
  assert.equal(seen[0].correlationId, 'run-42');
});

test('B05-L118 an unversioned, wrong-version or malformed client_payload is accepted but never trusted as a correlation id', async (t) => {
  const cases = [
    { action: 'x', client_payload: { correlationId: 'no-schema' } },
    { action: 'x', client_payload: { schema: 'aecp.event/v9', correlationId: 'future-version' } },
    { action: 'x', client_payload: { schema: 'aecp.event/v1', correlationId: { nested: true } } },
    { action: 'x', client_payload: { schema: 'aecp.event/v1', correlationId: 'has a space' } },
    { action: 'x', client_payload: { schema: 'aecp.event/v1', correlationId: 'x'.repeat(500) } },
    { action: 'x', client_payload: 'a string' },
    { action: 'x' }
  ];
  for (const payload of cases) {
    const { status, seen } = await receive(t, 'repository_dispatch', payload);
    assert.equal(status, 202, JSON.stringify(payload).slice(0, 60));
    assert.equal(seen[0].correlationId, null, JSON.stringify(payload).slice(0, 60));
  }
});

test('B05-L118 a client_payload is only read for repository_dispatch, and a workflow_run id keeps its meaning', async (t) => {
  const other = await receive(t, 'push', { client_payload: { schema: 'aecp.event/v1', correlationId: 'smuggled' } });
  assert.equal(other.seen[0].correlationId, null);
  const run = await receive(t, 'workflow_run', { workflow_run: { id: 777 }, client_payload: { schema: 'aecp.event/v1', correlationId: 'ignored' } });
  assert.equal(run.seen[0].correlationId, '777');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
