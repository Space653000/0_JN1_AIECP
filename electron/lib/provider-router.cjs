'use strict';

const { spawn } = require('node:child_process');

const PROVIDERS = Object.freeze({
  claude: { command: 'claude', roles: ['planner', 'reviewer'], mode: 'cli', network: true, credential: true },
  codex: { command: 'codex', roles: ['builder'], mode: 'cli', network: false, credential: true },
  gemini: { command: 'gemini', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'cli', network: true, credential: true },
  opencode: { command: 'opencode', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'cli', network: true, credential: true },
  ollama: { command: 'ollama', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'ollama', network: false, credential: false }
});

function run(command, args, { cwd, timeoutMs = 180000, signal, env = {}, maxOutputBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, aborted = false, outputLimitExceeded = false, settled = false, bytes = 0;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      reject(error);
    };
    const append = (kind, chunk) => {
      if (outputLimitExceeded) return;
      const text = chunk.toString();
      bytes += Buffer.byteLength(text);
      if (bytes > maxOutputBytes) {
        outputLimitExceeded = true;
        try { child.kill(); } catch {}
        return;
      }
      if (kind === 'stdout') stdout += text; else stderr += text;
    };
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, Math.max(1000, timeoutMs));
    const abort = () => { aborted = true; try { child.kill(); } catch {} };
    if (signal) signal.aborted ? abort() : signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', b => append('stdout', b));
    child.stderr.on('data', b => append('stderr', b));
    child.on('error', finishReject);
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      resolve({ code: Number.isInteger(code) ? code : -1, stdout, stderr, timedOut, aborted, outputLimitExceeded });
    });
  });
}

function normalizeRoles(provider) { return Array.isArray(provider?.roles) ? provider.roles : provider?.role ? [provider.role] : []; }

function safeNetworkUrl(value) {
  const url = new URL(String(value || ''));
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Network provider URL must use HTTPS, except loopback development endpoints.');
  return url;
}

async function executeOpenAICompatible(provider, role, prompt, opts = {}) {
  if (!opts.networkApproved) throw Object.assign(new Error('External provider network access requires explicit approval.'), { code: 'APPROVAL_REQUIRED', action: 'NETWORK' });
  if (provider.apiKey && !opts.credentialApproved) throw Object.assign(new Error('Provider credential use requires explicit approval.'), { code: 'APPROVAL_REQUIRED', action: 'CREDENTIAL' });
  const model = opts.model || provider.defaultModel || process.env[`AECP_${provider.id.toUpperCase()}_MODEL`] || '';
  if (!model) throw new Error('Network provider requires an explicit model.');
  const base = safeNetworkUrl(provider.baseUrl);
  const baseHref = base.href.endsWith('/') ? base.href : base.href + '/';
  const endpoint = new URL(String(provider.chatCompletionsPath || 'chat/completions').replace(/^\/+/, ''), baseHref);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1000, Number(opts.timeoutMs || 180000)));
  const externalAbort = () => controller.abort();
  if (opts.signal) opts.signal.aborted ? controller.abort() : opts.signal.addEventListener('abort', externalAbort, { once: true });
  try {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: String(prompt || '') }],
        temperature: 0
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) return { code: 1, stdout: '', stderr: `HTTP ${response.status}: ${raw.slice(-4000)}`, timedOut: false, aborted: false, provider: provider.id, model, usage: null };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Network provider returned invalid JSON.'); }
    const output = parsed?.choices?.[0]?.message?.content ?? parsed?.output_text ?? parsed?.response ?? parsed?.result;
    if (typeof output !== 'string') throw new Error('Network provider response does not contain assistant text.');
    return { code: 0, stdout: output, stderr: '', timedOut: false, aborted: false, provider: provider.id, model, usage: parsed?.usage || null };
  } catch (error) {
    if (error?.name === 'AbortError') return { code: -1, stdout: '', stderr: timedOut ? 'Network provider timed out.' : 'Network provider aborted.', timedOut, aborted: !timedOut, provider: provider.id, model, usage: null };
    throw error;
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
  }
}

class ProviderRouter {
  constructor(registry = PROVIDERS) { this.registry = registry; }

  resolve(role, preferred) {
    const ids = preferred ? [preferred] : Object.keys(this.registry);
    for (const id of ids) {
      const provider = this.registry[id];
      if (provider && normalizeRoles(provider).includes(role)) return { id, ...provider };
    }
    return null;
  }

  capabilities(role, preferred) {
    const provider = this.resolve(role, preferred);
    if (!provider) return null;
    return {
      provider: provider.id,
      role,
      mode: provider.mode,
      process: provider.mode !== 'openai-compatible',
      network: Boolean(provider.network || provider.mode === 'openai-compatible'),
      credential: Boolean(provider.credential || provider.apiKey),
      local: provider.mode === 'ollama' || provider.mode === 'local-command'
    };
  }

  commandSpec(providerId, role, prompt, { model, cwd } = {}) {
    const provider = this.resolve(role, providerId);
    if (!provider) throw new Error(`No provider for role: ${role}`);
    const selectedModel = model || provider.defaultModel || process.env[`AECP_${provider.id.toUpperCase()}_MODEL`] || '';
    if (provider.mode === 'openai-compatible') throw new Error('Network provider does not expose a local process command.');
    if (provider.mode === 'ollama') {
      if (!selectedModel) throw new Error('Ollama provider requires a model (options.model, provider defaultModel, or AECP_OLLAMA_MODEL).');
      return { command: provider.command, args: ['run', selectedModel, prompt], provider: provider.id, model: selectedModel, cwd: cwd || null };
    }
    if (provider.mode === 'local-command') {
      if (!provider.command || typeof provider.command !== 'string') throw new Error('Local command provider requires a fixed registered command.');
      const prefix = Array.isArray(provider.args) ? provider.args.map(String) : [];
      return { command: provider.command, args: [...prefix, prompt], provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    if (provider.id === 'codex') {
      const args = ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'workspace-write', '--json'];
      if (cwd) args.push('--cd', cwd);
      args.push('-c', 'sandbox_workspace_write.network_access=false');
      if (selectedModel) args.push('--model', selectedModel);
      args.push(prompt);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    if (provider.id === 'claude') {
      const args = ['-p', prompt, '--output-format', 'json'];
      if (selectedModel) args.push('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    if (provider.id === 'opencode') {
      const args = ['run'];
      if (selectedModel) args.push('--model', selectedModel);
      args.push(prompt);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    if (provider.id === 'gemini') {
      const args = ['-p', prompt];
      if (selectedModel) args.push('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    throw new Error(`Unsupported provider mode: ${provider.mode}`);
  }

  async execute(role, prompt, opts = {}) {
    const provider = this.resolve(role, opts.provider);
    if (!provider) throw new Error(`No provider for role: ${role}`);
    if (provider.mode === 'openai-compatible') return executeOpenAICompatible(provider, role, prompt, opts);
    const spec = this.commandSpec(provider.id, role, prompt, opts);
    return { ...await run(spec.command, spec.args, opts), provider: spec.provider, model: spec.model };
  }
}

module.exports = { ProviderRouter, PROVIDERS, run, safeNetworkUrl, executeOpenAICompatible };
