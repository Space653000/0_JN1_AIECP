'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'scope-test-token-abcdefghijklmnopqrstuvwxyz-123456';

async function startServer(t, workspaceRoot) {
  const { startLocalMcpServer } = await import('../electron/mcp-server.mjs');
  const runtime = await startLocalMcpServer({ workspaceRoot, token: TOKEN, port: 0 });
  t.after(async () => runtime.stop());
  return runtime;
}

async function rpc(runtime, method, params) {
  const response = await fetch(runtime.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data.slice('data: '.length));
}

const callTool = (runtime, name, args = {}) => rpc(runtime, 'tools/call', { name, arguments: args });
const toolText = (reply) => reply.result.content[0].text;

async function makeWorkspaces(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-scope-'));
  t.after(async () => fs.rm(base, { recursive: true, force: true }));
  const a = path.join(base, 'workspace-a');
  const b = path.join(base, 'workspace-b');
  const sibling = path.join(base, 'workspace-a-evil');
  for (const dir of [a, b, sibling]) await fs.mkdir(dir);
  await fs.writeFile(path.join(a, 'only-a.txt'), 'A-DATA');
  await fs.writeFile(path.join(b, 'only-b.txt'), 'B-DATA');
  await fs.writeFile(path.join(sibling, 'secret.txt'), 'SIBLING-SECRET');
  return { base, a, b, sibling };
}

test('B04-L185 a running Local MCP server stays bound to its Workspace and cannot reach another Workspace', async (t) => {
  const { a, b, sibling } = await makeWorkspaces(t);
  const serverA = await startServer(t, a);

  const own = await callTool(serverA, 'read_text_file', { path: 'only-a.txt' });
  assert.match(toolText(own), /A-DATA/);

  for (const target of [`..${path.sep}workspace-b${path.sep}only-b.txt`, `..${path.sep}workspace-a-evil${path.sep}secret.txt`, path.join(b, 'only-b.txt')]) {
    const reply = await callTool(serverA, 'read_text_file', { path: target });
    assert.equal(reply.result.isError, true, `must reject ${target}`);
    assert.doesNotMatch(toolText(reply), /B-DATA|SIBLING-SECRET/);
  }

  const listing = JSON.parse(toolText(await callTool(serverA, 'inspect_workspace')));
  assert.deepEqual(listing.entries.map((entry) => entry.name), ['only-a.txt']);
  assert.equal(listing.workspaceName, 'workspace-a');

  // Binding a second Workspace creates a separate server; it never widens the first one.
  const serverB = await startServer(t, b);
  const bListing = JSON.parse(toolText(await callTool(serverB, 'inspect_workspace')));
  assert.deepEqual(bListing.entries.map((entry) => entry.name), ['only-b.txt']);
  const stillA = JSON.parse(toolText(await callTool(serverA, 'inspect_workspace')));
  assert.deepEqual(stillA.entries.map((entry) => entry.name), ['only-a.txt']);
  const crossRead = await callTool(serverA, 'read_text_file', { path: 'only-b.txt' });
  assert.equal(crossRead.result.isError, true);
});

test('B04-L185 the running server runtime exposes no way to change its Workspace scope', async (t) => {
  const { a } = await makeWorkspaces(t);
  const runtime = await startServer(t, a);
  assert.deepEqual(Object.keys(runtime).sort(), ['healthUrl', 'mode', 'port', 'stop', 'url']);
  assert.equal(runtime.mode, 'read-only');
});

test('R6.2 Local MCP tools are the four read-only semantic tools and no raw shell is exposed', async (t) => {
  const { a } = await makeWorkspaces(t);
  const runtime = await startServer(t, a);

  const listed = await rpc(runtime, 'tools/list', {});
  const names = listed.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['aecp_status', 'git_status', 'inspect_workspace', 'read_text_file']);

  for (const tool of listed.result.tools) {
    assert.doesNotMatch(`${tool.name} ${tool.description}`, /\b(shell|exec|execute|run_command|terminal|spawn|powershell|bash|cmd)\b/i, `${tool.name} must not be a shell`);
    assert.match(tool.description, /read-only/i, `${tool.name} must declare read-only`);
    const props = Object.keys(tool.inputSchema.properties || {});
    assert.ok(props.every((prop) => prop === 'path'), `${tool.name} accepts no command-like input`);
  }

  const status = JSON.parse(toolText(await callTool(runtime, 'aecp_status')));
  assert.equal(status.mode, 'read-only');
  assert.deepEqual([...status.capabilities].sort(), names);

  for (const forbidden of ['run_shell', 'exec', 'write_file', 'delete_file', 'git_push']) {
    const reply = await callTool(runtime, forbidden, { command: 'whoami', path: 'x', content: 'x' });
    assert.ok(reply.error || reply.result?.isError, `${forbidden} must not be callable`);
  }
  await assert.rejects(fs.access(path.join(a, 'x')), 'no file may be created by MCP calls');
});
