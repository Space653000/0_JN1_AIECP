'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ProviderRouter } = require('../electron/lib/provider-router.cjs');

const seen = [];
let behavior = { '/v1/responses': 401, '/v1/chat/completions': 404 };
const server = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null });
  if (behavior.hang) return;
  res.writeHead(behavior[req.url.split('?')[0]] ?? 404, { 'content-type': 'application/json' });
  res.end('{}');
});
test.before(() => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)));
test.after(() => { server.closeAllConnections?.(); return new Promise((resolve) => server.close(resolve)); });

const router = (wireApi, extra = {}) => new ProviderRouter({
  worker: { id: 'worker', mode: 'codex-cli', roles: ['builder'], command: 'codex', codexHome: '/tmp/home', network: true, requiresCredential: true, apiKey: 'sk-worker-secret-0123456789', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'm', wireApi, ...extra }
}, { runner: async () => ({ code: 0, stdout: 'codex 1.0', stderr: '', timedOut: false, aborted: false }) });

test('G15-C an approved worker health check probes the endpoint for the selected wire API, without credentials', async () => {
  seen.length = 0;
  behavior = { '/v1/responses': 401, '/v1/chat/completions': 404 };
  const ok = await router('responses').health('worker', { networkApproved: true, credentialApproved: true, timeoutMs: 2000 });
  assert.equal(ok.status, 'READY');
  assert.ok(seen.length >= 1 && seen.every((call) => call.url === '/v1/responses' && call.authorization === null), 'one bounded probe of the selected API, never carrying the key');
  const bad = await router('chat').health('worker', { networkApproved: true, credentialApproved: true, timeoutMs: 2000 });
  assert.equal(bad.status, 'DEGRADED');
  assert.equal(bad.reason, 'WIRE_API_UNSUPPORTED');
  assert.ok(!JSON.stringify(bad).includes('sk-worker') && !/[?]/.test(bad.detail));
});

test('G15-C a hanging or unreachable endpoint degrades the worker, and without network approval nothing is requested', async () => {
  behavior = { hang: true };
  const slow = await router('responses').health('worker', { networkApproved: true, credentialApproved: true, timeoutMs: 1000 });
  assert.equal(slow.status, 'DEGRADED');
  assert.equal(slow.reason, 'ENDPOINT_TIMEOUT');
  const dead = await router('responses', { baseUrl: 'http://127.0.0.1:1/v1' }).health('worker', { networkApproved: true, credentialApproved: true, timeoutMs: 1500 });
  assert.equal(dead.status, 'DEGRADED');
  assert.equal(dead.reason, 'ENDPOINT_UNREACHABLE');
  seen.length = 0;
  const offline = await router('responses').health('worker', { networkApproved: false });
  assert.equal(offline.status, 'DEGRADED');
  assert.deepEqual(seen, []);
});
