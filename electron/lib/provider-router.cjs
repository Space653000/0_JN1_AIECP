'use strict';

const { spawn } = require('node:child_process');

const PROVIDERS = Object.freeze({
  claude: { command: 'claude', roles: ['planner', 'reviewer'], mode: 'cli' },
  codex: { command: 'codex', roles: ['builder'], mode: 'cli' },
  gemini: { command: 'gemini', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'cli' },
  opencode: { command: 'opencode', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'cli' },
  ollama: { command: 'ollama', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'ollama' }
});

function run(command, args, { cwd, timeoutMs = 180000, signal, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', timedOut = false, aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, Math.max(1000, timeoutMs));
    const abort = () => {
      aborted = true;
      try { child.kill(); } catch {}
    };
    if (signal) signal.aborted ? abort() : signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      resolve({ code: Number.isInteger(code) ? code : -1, stdout, stderr, timedOut, aborted });
    });
  });
}

function normalizeRoles(provider) {
  if (!provider) return [];
  if (Array.isArray(provider.roles)) return provider.roles;
  return provider.role ? [provider.role] : [];
}

class ProviderRouter {
  constructor(registry = PROVIDERS) {
    this.registry = registry;
  }

  resolve(role, preferred) {
    const ids = preferred ? [preferred] : Object.keys(this.registry);
    for (const id of ids) {
      const provider = this.registry[id];
      if (!provider) continue;
      const roles = normalizeRoles(provider);
      if (roles.includes(role) || (role === 'general' && roles.includes('general'))) return { id, ...provider };
    }
    return null;
  }

  commandSpec(providerId, role, prompt, { model } = {}) {
    const provider = this.resolve(role, providerId);
    if (!provider) throw new Error(`No provider for role: ${role}`);
    const selectedModel = model || process.env[`AECP_${provider.id.toUpperCase()}_MODEL`] || '';
    if (provider.mode === 'ollama') {
      if (!selectedModel) throw new Error('Ollama provider requires a model (options.model or AECP_OLLAMA_MODEL).');
      return { command: provider.command, args: ['run', selectedModel, prompt], provider: provider.id, model: selectedModel };
    }
    if (provider.id === 'codex') {
      const args = ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=false'];
      if (selectedModel) args.push('--model', selectedModel);
      args.push(prompt);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null };
    }
    if (provider.id === 'claude') {
      const args = ['-p', prompt, '--output-format', 'json'];
      if (selectedModel) args.push('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null };
    }
    if (provider.id === 'opencode') {
      const args = ['run', prompt];
      if (selectedModel) args.unshift('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null };
    }
    if (provider.id === 'gemini') {
      const args = ['-p', prompt];
      if (selectedModel) args.push('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null };
    }
    throw new Error(`Unsupported provider mode: ${provider.mode}`);
  }

  async execute(role, prompt, opts = {}) {
    const spec = this.commandSpec(opts.provider, role, prompt, opts);
    return { ...await run(spec.command, spec.args, opts), provider: spec.provider, model: spec.model };
  }
}

module.exports = { ProviderRouter, PROVIDERS, run };