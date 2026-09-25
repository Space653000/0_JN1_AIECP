'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { loadMain } = require('./support/fake-electron-main.cjs');

// The runtime credential of a remote MCP tunnel is an OpenAI platform credential: it must be handled as a secret.
const TUNNEL_SECRET = 'mcp-tunnel-runtime-credential-2f9d8c7b6a5e4d3c2b1a';
const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const received = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  received.push({ method: req.method, authorization: req.headers.authorization || null });
  if (mode === 'echo-401') { res.writeHead(401, { 'content-type': 'text/plain' }); res.end(`bad credential: ${req.headers.authorization}`); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
let providerId;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await ctx.start();
  const saved = await H('provider:save', { name: 'Tunnel MCP', kind: 'remote-mcp', baseUrl: `http://127.0.0.1:${server.address().port}/mcp`, apiKey: TUNNEL_SECRET });
  providerId = saved.id;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

const health = (extra) => H('provider:health', { providerId, timeoutMs: 3000, ...extra });
// Atomic-write temp files are renamed away while the tree is walked and never hold committed state.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : (/.tmp(?:-d+-d+)?$|.d+.tmp$/.test(entry.name) ? [] : [path.join(dir, entry.name)])));

test('B16-L229 the tunnel credential leaves the machine only after explicit NETWORK and CREDENTIAL approval, and only to the configured endpoint', async () => {
  received.length = 0;
  assert.equal((await health({})).status, 'DEGRADED', 'no network approval: no probe at all');
  assert.equal((await health({ networkApproved: true })).status, 'AUTH_REQUIRED', 'network approved but no credential approval: still no request');
  assert.deepEqual(received, [], 'the server saw nothing, so the credential was not used');
  const approved = await health({ networkApproved: true, credentialApproved: true });
  assert.equal(approved.status, 'READY');
  assert.deepEqual(received, [{ method: 'GET', authorization: `Bearer ${TUNNEL_SECRET}` }], 'used once, as a bearer, against the configured endpoint');
});

test('B16-L229 an endpoint that echoes the credential back cannot make AECP display or keep it', async () => {
  mode = 'echo-401';
  const result = await health({ networkApproved: true, credentialApproved: true });
  mode = 'ok';
  assert.equal(result.status, 'AUTH_REQUIRED');
  assert.ok(!JSON.stringify(result).includes(TUNNEL_SECRET), 'the health result never carries the secret');
});

test('B16-L229 the tunnel credential exists only as OS-encrypted ciphertext: not in listings, state, backups, logs or evidence', async () => {
  const listed = JSON.stringify(await H('provider:list'));
  assert.ok(!listed.includes(TUNNEL_SECRET));
  assert.match(listed, /"hasCredential":true/);
  const stored = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'credentials.json'), 'utf8'));
  assert.equal(Object.keys(stored.values).length, 1);
  const [ciphertext] = Object.values(stored.values);
  assert.ok(!Buffer.from(ciphertext, 'base64').toString('latin1').includes(TUNNEL_SECRET), 'encrypted at rest');
  for (const file of walk(ctx.userData)) {
    const text = fs.readFileSync(file).toString('latin1');
    assert.ok(!text.includes(TUNNEL_SECRET), `${path.relative(ctx.userData, file)} must not contain the credential`);
    if (!file.endsWith('credentials.json')) assert.ok(!text.includes(ciphertext), `${path.relative(ctx.userData, file)} must not contain the ciphertext either`);
  }
  assert.ok(ctx.record.console.every((line) => !line.includes(TUNNEL_SECRET)), 'nothing was logged');
  assert.deepEqual(ctx.record.clipboard, [], 'and nothing was copied');
});

test('B16-L229 when the OS cannot encrypt, the credential is refused instead of stored in the clear', async () => {
  ctx.control.encryptionAvailable = false;
  try {
    await assert.rejects(() => H('provider:save', { name: 'Second Tunnel', kind: 'remote-mcp', baseUrl: 'https://mcp.example.com/mcp', apiKey: `${TUNNEL_SECRET}-second` }), /encrypt|safeStorage|protect|unavailable/i);
  } finally { ctx.control.encryptionAvailable = true; }
  for (const file of walk(ctx.userData)) assert.ok(!fs.readFileSync(file).toString('latin1').includes(`${TUNNEL_SECRET}-second`), path.basename(file));
});
