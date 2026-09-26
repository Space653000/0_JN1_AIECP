'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOKEN = 'semantic-contract-token-abcdefghijklmnopqrstuvwxyz-123456';
const SHELL_WORDS = /shell|exec|command|cmd|script|eval|spawn|bash|powershell|terminal|sudo|run_|invoke|system/i;

async function boot(t) {
  const { startLocalMcpServer } = await import('../electron/mcp-server.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-mcp-contract-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  await fs.writeFile(path.join(dir, 'a.txt'), 'A-DATA');
  const runtime = await startLocalMcpServer({ workspaceRoot: dir, token: TOKEN, port: 0 });
  t.after(async () => { await runtime.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  const rpc = async (method, params, id = 1) => {
    const response = await fetch(runtime.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const data = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
    return JSON.parse(data.slice('data: '.length));
  };
  return { dir, runtime, rpc };
}

test('B16-L233 the MCP surface is exactly four semantic read-only tools with bounded typed inputs and no shell-shaped parameter', async (t) => {
  const { rpc } = await boot(t);
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'contract', version: '1' } });
  assert.deepEqual(Object.keys(init.result.capabilities), ['tools'], 'the server offers tools only: no sampling, resources or prompts that could carry commands');
  const { tools } = (await rpc('tools/list', {})).result;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['aecp_status', 'git_status', 'inspect_workspace', 'read_text_file']);
  for (const tool of tools) {
    assert.match(tool.description, /read-only/i,`${tool.name} declares itself read-only`);
    assert.doesNotMatch(tool.name, SHELL_WORDS, `${tool.name} is not shell-shaped`);
    const properties = tool.inputSchema.properties || {};
    for (const [name, schema] of Object.entries(properties)) {
      assert.doesNotMatch(name, SHELL_WORDS, `${tool.name}.${name} must not look like a command parameter`);
      assert.equal(schema.type, 'string');
      assert.ok(Number.isInteger(schema.maxLength) && schema.maxLength <= 1024, `${tool.name}.${name} is length-bounded`);
    }
    assert.ok(!tool.inputSchema.additionalProperties, `${tool.name} accepts no open-ended arguments`);
  }
  assert.deepEqual(tools.filter((tool) => Object.keys(tool.inputSchema.properties || {}).length).map((tool) => tool.name), ['read_text_file'], 'only the file reader takes an argument, and it is a workspace-relative path');
});

test('B16-L233 shell-shaped tools do not exist and extra command arguments to real tools are inert', async (t) => {
  const { dir, rpc } = await boot(t);
  const marker = path.join(dir, 'pwned.txt');
  const payload = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}','x')"`;
  for (const name of ['run_shell', 'exec', 'bash', 'powershell', 'run_command', 'execute', 'shell', 'run_test_profile', 'apply_patch_scoped', 'git_commit', 'eval']) {
    const reply = await rpc('tools/call', { name, arguments: { command: payload, cmd: payload, script: payload, args: [payload] } });
    assert.ok(reply.error || reply.result?.isError, `${name} must be refused`);
    assert.match(JSON.stringify(reply), /not found|Unknown|unknown|isError/);
  }
  for (const [name, args] of [['aecp_status', { command: payload }], ['inspect_workspace', { command: payload, cwd: '/' }], ['git_status', { args: ['--upload-pack', payload], command: payload }], ['read_text_file', { path: 'a.txt', command: payload }]]) {
    const reply = await rpc('tools/call', { name, arguments: args });
    assert.ok(reply.result || reply.error, name);
    assert.doesNotMatch(JSON.stringify(reply), /pwned/, `${name} must not echo or run the injected command`);
  }
  await assert.rejects(() => fs.access(marker), 'no injected command ever ran');
  const read = await rpc('tools/call', { name: 'read_text_file', arguments: { path: 'a.txt', command: payload } });
  assert.match(read.result.content[0].text, /A-DATA/, 'the real tool still does its one job');
});

test('B16-L233 an unauthenticated caller cannot list or call any tool', async (t) => {
  const { runtime } = await boot(t);
  for (const headers of [{}, { authorization: 'Bearer wrong-token' }]) {
    const response = await fetch(runtime.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.ok([401, 403].includes(response.status), `status ${response.status}`);
    assert.doesNotMatch(await response.text(), /read_text_file|inspect_workspace/);
  }
});
