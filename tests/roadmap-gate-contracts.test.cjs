'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { ProviderRouter } = require('../electron/lib/provider-router.cjs');
const { COMMAND_SCHEMA, RESULT_SCHEMA } = require('../electron/lib/protocol.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-roadmap-'));
const emptyBin = path.join(sandbox, 'empty');
const fakeBin = path.join(sandbox, 'fake-git');
const workspace = path.join(sandbox, 'workspace');
const realPath = process.env.PATH;

test.before(async () => {
  fs.mkdirSync(emptyBin);
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  if (process.platform === 'win32') fs.copyFileSync(process.execPath, path.join(fakeBin, 'git.exe'));
  else { fs.writeFileSync(path.join(fakeBin, 'git'), '#!/bin/sh\necho "git version 9.9.9"\n'); fs.chmodSync(path.join(fakeBin, 'git'), 0o755); }
  await ctx.start();
});
test.after(() => {
  process.env.PATH = realPath;
  fs.rmSync(sandbox, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('B07-DETECT the tools AECP detects on its own are exactly the documented set, reported factually', async () => {
  process.env.PATH = emptyBin;
  const none = await H('tools:detect');
  process.env.PATH = `${fakeBin}${path.delimiter}${emptyBin}`;
  const some = await H('tools:detect');
  process.env.PATH = realPath;
  assert.deepEqual(none.map((tool) => tool.id), ['git', 'pwsh', 'powershell', 'python', 'node', 'gh', 'ollama']);
  assert.deepEqual(none.map((tool) => tool.name), ['Git', 'PowerShell 7', 'Windows PowerShell', 'Python', 'Node.js', 'GitHub CLI', 'Ollama']);
  assert.ok(none.every((tool) => tool.available === false), 'nothing on PATH means nothing is reported available');
  const git = some.find((tool) => tool.id === 'git');
  assert.equal(git.available, true);
  assert.match(git.version, /\d+\.\d+/);
  assert.ok(some.filter((tool) => tool.id !== 'git').every((tool) => tool.available === false));
});

test('B07-DETECT the runtime and application architecture are reported by the app, not asked from the user', async () => {
  const info = await H('app:info');
  assert.equal(info.arch, process.arch);
  assert.equal(info.platform, process.platform);
  assert.equal(typeof info.version, 'string');
});

test('B07-PERSIST a chosen Workspace is remembered and reopened on the next launch without any setup', async () => {
  ctx.control.chosenFolder = workspace;
  const chosen = await H('workspace:select');
  const userData = ctx.userData;
  const next = spawnSync(process.execPath, [path.join(__dirname, 'support', 'main-session.cjs'), userData, '', 'state'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(next.status, 0, next.stderr);
  const restarted = JSON.parse(next.stdout.split('\n').find((line) => line.startsWith('RESULT ')).slice(7));
  assert.equal(restarted.currentWorkspaceId, chosen.id);
  assert.equal(restarted.rootPath, chosen.rootPath);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-roadmap-fresh-'));
  try {
    const first = spawnSync(process.execPath, [path.join(__dirname, 'support', 'main-session.cjs'), fresh, '', 'state'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(JSON.parse(first.stdout.split('\n').find((line) => line.startsWith('RESULT ')).slice(7)).currentWorkspaceId, null, 'a first launch has no Workspace and never guesses one');
  } finally { fs.rmSync(fresh, { recursive: true, force: true }); }
});

test('B24-CONFIG Ollama needs an explicit model and its command is the fixed local CLI run with the Harness working directory', () => {
  const router = new ProviderRouter();
  const previous = process.env.AECP_OLLAMA_MODEL;
  delete process.env.AECP_OLLAMA_MODEL;
  try {
    assert.throws(() => router.commandSpec('ollama', 'planner', 'plan it', { cwd: '/w' }), /requires a model/);
    assert.deepEqual(router.commandSpec('ollama', 'planner', 'plan it', { model: 'qwen3:8b', cwd: '/w' }), { command: 'ollama', args: ['run', 'qwen3:8b', 'plan it'], provider: 'ollama', model: 'qwen3:8b', cwd: '/w' });
    process.env.AECP_OLLAMA_MODEL = 'env-model';
    assert.equal(router.commandSpec('ollama', 'planner', 'p', { cwd: '/w' }).model, 'env-model', 'AECP_<PROVIDER>_MODEL is the process-level default');
    assert.equal(router.commandSpec('ollama', 'planner', 'p', { model: 'explicit', cwd: '/w' }).model, 'explicit', 'an explicit model always wins');
  } finally { if (previous === undefined) delete process.env.AECP_OLLAMA_MODEL; else process.env.AECP_OLLAMA_MODEL = previous; }
  assert.equal(router.resolve('planner', 'ollama').id, 'ollama', 'options.provider selects the provider');
  assert.equal(router.resolve('planner', 'no-such-provider'), null);
});

test('B24-CONFIG the Codex Builder keeps the bounded workspace-write sandbox with sandbox network access off', () => {
  const spec = new ProviderRouter().commandSpec('codex', 'builder', 'build', { cwd: '/work', model: 'm' });
  assert.equal(spec.command, 'codex');
  const args = spec.args;
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(args.includes('sandbox_workspace_write.network_access=false'));
  assert.equal(args[args.indexOf('--cd') + 1], '/work');
  assert.ok(!args.includes('danger-full-access') && !args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('B07-SCHEMA the command/result protocol has its own schema version, independent of the application version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(COMMAND_SCHEMA, 'aecp.task/v1');
  assert.equal(RESULT_SCHEMA, 'aecp.result/v1');
  assert.ok(!COMMAND_SCHEMA.includes(pkg.version) && !RESULT_SCHEMA.includes(pkg.version));
});

test('B06-DOCK moving a browser window needs the operator approval, and a cancelled dialog moves nothing', async () => {
  ctx.control.messageBoxResponse = 0;
  await assert.rejects(() => H('desktop:dock-browser', { pid: 2147483000, side: 'left' }), /not approved by the operator/);
  ctx.control.messageBoxResponse = 1;
  await assert.rejects(() => H('desktop:dock-browser', { pid: 2147483000, side: 'left' }), (error) => !/not approved by the operator/.test(error.message), 'after approval the request reaches the allowlist-checking adapter, which refuses a non-browser pid');
});
