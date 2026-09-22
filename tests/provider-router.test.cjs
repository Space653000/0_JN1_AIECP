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
