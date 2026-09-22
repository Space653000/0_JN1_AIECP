'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');

test('provider registry exposes vendor-neutral roles including Ollama', () => {
  assert.deepEqual(PROVIDERS.ollama.roles, ['planner', 'reviewer', 'general']);
  assert.equal(PROVIDERS.ollama.mode, 'ollama');
});

test('Ollama command spec is local and requires an explicit model', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('ollama', 'reviewer', 'review work', { model: 'qwen3-coder:30b', cwd: 'C:\\repo' });
  assert.equal(spec.command, 'ollama');
  assert.deepEqual(spec.args, ['run', 'qwen3-coder:30b', 'review work']);
  assert.equal(spec.provider, 'ollama');
  assert.equal(spec.model, 'qwen3-coder:30b');
  assert.equal(spec.cwd, 'C:\\repo');
});

test('Ollama can obtain the model from AECP_OLLAMA_MODEL', () => {
  const previous = process.env.AECP_OLLAMA_MODEL;
  process.env.AECP_OLLAMA_MODEL = 'qwen3-coder:30b';
  try {
    const spec = new ProviderRouter().commandSpec('ollama', 'reviewer', 'review');
    assert.equal(spec.args[0], 'run');
    assert.equal(spec.args[1], 'qwen3-coder:30b');
  } finally {
    if (previous === undefined) delete process.env.AECP_OLLAMA_MODEL;
    else process.env.AECP_OLLAMA_MODEL = previous;
  }
});

test('Ollama without a model is rejected instead of silently selecting one', () => {
  const previous = process.env.AECP_OLLAMA_MODEL;
  delete process.env.AECP_OLLAMA_MODEL;
  try {
    assert.throws(() => new ProviderRouter().commandSpec('ollama', 'reviewer', 'work'), /requires a model/);
  } finally {
    if (previous !== undefined) process.env.AECP_OLLAMA_MODEL = previous;
  }
});

test('Codex builder keeps the bounded workspace sandbox', () => {
  const spec = new ProviderRouter().commandSpec('codex', 'builder', 'build', { model: 'test-model', cwd: 'C:\\repo' });
  assert.equal(spec.command, 'codex');
  assert.ok(spec.args.includes('--sandbox'));
  assert.ok(spec.args.includes('workspace-write'));
  assert.ok(spec.args.includes('--json'));
  assert.ok(spec.args.includes('--cd'));
  assert.ok(spec.args.includes('C:\\repo'));
  assert.ok(spec.args.includes('sandbox_workspace_write.network_access=false'));
});

test('fixed local-command provider uses only its registered executable and arguments', () => {
  const registry = { local: { command: 'trusted-local-worker', args: ['--bounded'], roles: ['builder'], mode: 'local-command' } };
  const spec = new ProviderRouter(registry).commandSpec('local', 'builder', 'TASK_TEXT_CANNOT_SELECT_EXECUTABLE', { cwd: 'C:\\repo' });
  assert.equal(spec.command, 'trusted-local-worker');
  assert.deepEqual(spec.args, ['--bounded', 'TASK_TEXT_CANNOT_SELECT_EXECUTABLE']);
  assert.equal(spec.cwd, 'C:\\repo');
});

test('unknown provider mode is rejected', () => {
  const registry = { local: { command: 'worker', roles: ['builder'], mode: 'unknown-mode' } };
  assert.throws(() => new ProviderRouter(registry).commandSpec('local', 'builder', 'work'), /Unsupported provider mode/);
});

test('raw Ollama is not exposed as a mutating builder', () => {
  assert.throws(() => new ProviderRouter().commandSpec('ollama', 'builder', 'edit files', { model: 'qwen3-coder:30b' }), /No provider for role: builder/);
});

test('Claude planner and reviewer run in plan-only permission mode', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('claude', 'planner', 'plan safely', { cwd: 'C:\\repo' });
  assert.ok(spec.args.includes('--permission-mode'));
  assert.ok(spec.args.includes('plan'));
  assert.ok(spec.args.includes('--max-turns'));
});

test('Gemini is read-only for Harness roles and is not a builder', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('gemini', 'reviewer', 'review safely', { cwd: 'C:\\repo' });
  assert.ok(spec.args.includes('--approval-mode'));
  assert.ok(spec.args.includes('plan'));
  assert.throws(() => router.commandSpec('gemini', 'builder', 'edit files'), /No provider for role: builder/);
});

test('OpenCode builder receives deny-first v1 permissions', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('opencode', 'builder', 'edit only the worktree', {
    model: 'ollama/qwen3-coder:30b',
    cwd: 'C:\\repo',
    providerVersion: '1.18.30'
  });
  assert.ok(spec.args.includes('--auto'));
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.permission['*'], 'deny');
  assert.equal(config.permission.edit, 'allow');
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.bash['*'], 'deny');
});

test('OpenCode builder receives deny-first v2 permissions', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('opencode', 'builder', 'edit only the worktree', {
    model: 'ollama/qwen3-coder:30b',
    cwd: 'C:\\repo',
    providerVersion: '2.1.0'
  });
  assert.equal(spec.args.includes('--auto'), false);
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.ok(config.permissions.some((rule) => rule.action === 'external_directory' && rule.effect === 'deny'));
  assert.ok(config.permissions.some((rule) => rule.action === 'shell' && rule.resource === '*' && rule.effect === 'deny'));
  assert.ok(config.permissions.some((rule) => rule.action === 'edit' && rule.effect === 'allow'));
  assert.ok(config.permissions.some((rule) => rule.action === 'execute' && rule.effect === 'deny'));
});

test('OpenCode local models do not request model-network approval but cloud models do', () => {
  const router = new ProviderRouter();
  assert.equal(router.capabilities('builder', 'opencode', { model: 'ollama/qwen3-coder:30b' }).network, false);
  assert.equal(router.capabilities('builder', 'opencode', { model: 'openai/gpt-code' }).network, true);
});

test('built-in CLI authentication is not exposed to AECP as a credential capability', () => {
  const router = new ProviderRouter();
  assert.equal(router.capabilities('builder', 'codex').credential, false);
  assert.equal(router.capabilities('planner', 'claude').credential, false);
  assert.equal(router.capabilities('reviewer', 'gemini').credential, false);
});
