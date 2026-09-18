'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('Local MCP starts on loopback, exposes health, and rejects missing bearer auth', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-mcp-'));
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));

  const { startLocalMcpServer } = await import('../electron/mcp-server.mjs');
  const runtime = await startLocalMcpServer({
    workspaceRoot: dir,
    token: 'test-token-abcdefghijklmnopqrstuvwxyz-123456',
    port: 0
  });
  t.after(async () => runtime.stop());

  assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.match(runtime.healthUrl, /^http:\/\/127\.0\.0\.1:\d+\/healthz$/);

  const health = await fetch(runtime.healthUrl);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, mode: 'read-only' });

  const unauthenticated = await fetch(runtime.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  });
  assert.equal(unauthenticated.status, 401);
});
