'use strict';

const { spawn } = require('node:child_process');
const { resolveKnownCommand } = require('./command-resolver.cjs');

const PROVIDERS = Object.freeze({
  claude: { command: 'claude', roles: ['planner', 'reviewer'], mode: 'cli', network: true, credential: false },
  codex: { command: 'codex', roles: ['builder'], mode: 'cli', network: false, credential: false },
  gemini: { command: 'gemini', roles: ['planner', 'reviewer', 'general'], mode: 'cli', network: true, credential: false },
  opencode: { command: 'opencode', roles: ['planner', 'builder', 'reviewer', 'general'], mode: 'cli', network: true, credential: false },
  ollama: { command: 'ollama', roles: ['planner', 'reviewer', 'general'], mode: 'ollama', network: false, credential: false }
});

function run(command, args, { cwd, timeoutMs = 180000, signal, env = {}, maxOutputBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const resolved = resolveKnownCommand(command, args);
    const child = spawn(resolved.command, resolved.args, { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
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

function parseMajor(versionText) {
  const match = String(versionText || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? Number(match[1]) : 1;
}

function openCodeBoundedConfig(versionText) {
  if (parseMajor(versionText) >= 2) {
    return {
      permissions: [
        { action: 'external_directory', resource: '*', effect: 'deny' },
        { action: 'shell', resource: '*', effect: 'deny' },
        { action: 'shell', resource: 'git status *', effect: 'allow' },
        { action: 'shell', resource: 'git diff *', effect: 'allow' },
        { action: 'read', resource: '*', effect: 'allow' },
        { action: 'edit', resource: '*', effect: 'allow' },
        { action: 'glob', resource: '*', effect: 'allow' },
        { action: 'grep', resource: '*', effect: 'allow' },
        { action: 'webfetch', resource: '*', effect: 'deny' },
        { action: 'websearch', resource: '*', effect: 'deny' },
        { action: 'subagent', resource: '*', effect: 'deny' },
        { action: 'skill', resource: '*', effect: 'deny' },
        { action: 'execute', resource: '*', effect: 'deny' }
      ]
    };
  }
  return {
    permission: {
      '*': 'deny',
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      bash: { '*': 'deny', 'git status*': 'allow', 'git diff*': 'allow' },
      external_directory: 'deny',
      doom_loop: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      task: 'deny'
    }
  };
}

function modelLooksLocal(model) {
  return /^(?:ollama|local|lmstudio|llamacpp)\//i.test(String(model || '').trim());
}

function safeNetworkUrl(value) {
  const url = new URL(String(value || ''));
  if (url.username || url.password) throw new Error('Provider URL must not contain embedded credentials.');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Network provider URL must use HTTPS, except loopback development endpoints.');
  return url;
}

function sanitizeNumericMetadata(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/token|cost|price|credit|cached|reasoning|input|output|prompt|completion|total/i.test(key)) continue;
    const sanitized = sanitizeNumericMetadata(item, depth + 1);
    if (sanitized !== null && (typeof sanitized !== 'object' || Object.keys(sanitized).length)) out[key] = sanitized;
  }
  return Object.keys(out).length ? out : null;
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
    if (!response.ok) return { code: 1, stdout: '', stderr: `HTTP ${response.status}: ${raw.slice(-4000)}`, timedOut: false, aborted: false, provider: provider.id, model, command: 'openai-compatible', usage: null };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Network provider returned invalid JSON.'); }
    const output = parsed?.choices?.[0]?.message?.content ?? parsed?.output_text ?? parsed?.response ?? parsed?.result;
    if (typeof output !== 'string') throw new Error('Network provider response does not contain assistant text.');
    return { code: 0, stdout: output, stderr: '', timedOut: false, aborted: false, provider: provider.id, model, command: 'openai-compatible', usage: parsed?.usage || null };
  } catch (error) {
    if (error?.name === 'AbortError') return { code: -1, stdout: '', stderr: timedOut ? 'Network provider timed out.' : 'Network provider aborted.', timedOut, aborted: !timedOut, provider: provider.id, model, command: 'openai-compatible', usage: null };
    throw error;
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
  }
}

class ProviderRouter {
  constructor(registry = PROVIDERS, { runner = run, fetchImpl = globalThis.fetch, platform = process.platform, metricsSink = null } = {}) {
    this.registry = registry;
    this.runner = runner;
    this.fetchImpl = fetchImpl;
    this.platform = platform;
    this.metricsSink = typeof metricsSink === 'function' ? metricsSink : null;
  }

  async recordMetric(metric) {
    if (!this.metricsSink) return;
    try { await this.metricsSink(metric); } catch {}
  }

  async health(providerId, opts = {}) {
    const provider = this.registry[providerId];
    const checkedAt = new Date().toISOString();
    const result = (status, detail, extra = {}) => ({ provider: providerId, status, detail, checkedAt, ...extra });
    if (!provider) return result('NOT_CONFIGURED', 'Provider is not registered.');

    if (provider.mode === 'ollama' || provider.mode === 'cli' || provider.mode === 'codex-cli') {
      const probe = await this.runner(provider.command, ['--version'], {
        timeoutMs: Math.min(10000, Math.max(1000, Number(opts.timeoutMs || 5000))),
        maxOutputBytes: 16 * 1024,
        signal: opts.signal
      }).catch((error) => ({ code: -1, stdout: '', stderr: error?.message || String(error), timedOut: false, aborted: false }));
      if (probe.code !== 0) return result('UNAVAILABLE', (probe.stderr || probe.stdout || 'Provider CLI is unavailable.').slice(0, 500));
      if (provider.mode === 'ollama' && !(opts.model || provider.defaultModel || process.env.AECP_OLLAMA_MODEL)) {
        return result('DEGRADED', 'Ollama CLI is available, but an explicit model is required before invocation.', { version: (probe.stdout || probe.stderr || '').split(/\r?\n/)[0] });
      }
      if (provider.mode === 'codex-cli') {
        if (!provider.codexHome) return result('NOT_CONFIGURED', 'Isolated CODEX_HOME is missing.');
        if (provider.baseUrl && !provider.defaultModel) return result('NOT_CONFIGURED', 'Custom Codex worker requires an explicit model.', { workerId: provider.workerId || providerId, codexHome: provider.codexHome });
        if (provider.requiresCredential && !provider.apiKey) return result('AUTH_REQUIRED', 'Worker credential is not configured.', { workerId: provider.workerId || providerId, codexHome: provider.codexHome });
        if (provider.requiresAuthFiles && !provider.authPresent) return result('AUTH_REQUIRED', 'Codex OFFICIAL isolated CODEX_HOME requires authentication.', { workerId: provider.workerId || providerId, codexHome: provider.codexHome });
        return result('READY', 'Codex CLI and isolated worker runtime are configured.', {
          version: (probe.stdout || probe.stderr || '').split(/\r?\n/)[0],
          workerId: provider.workerId || providerId,
          workerName: provider.workerName || providerId,
          providerName: provider.providerName || providerId,
          model: opts.model || provider.defaultModel || null,
          codexHome: provider.codexHome,
          wireApi: provider.wireApi || null
        });
      }
      return result('READY', 'Provider CLI is available.', { version: (probe.stdout || probe.stderr || '').split(/\r?\n/)[0] });
    }

    if (provider.mode === 'local-command') {
      if (!provider.command) return result('NOT_CONFIGURED', 'Fixed local command is missing.');
      const locator = this.platform === 'win32' ? 'where.exe' : 'which';
      const probe = await this.runner(locator, [provider.command], {
        timeoutMs: Math.min(10000, Math.max(1000, Number(opts.timeoutMs || 5000))),
        maxOutputBytes: 16 * 1024,
        signal: opts.signal
      }).catch((error) => ({ code: -1, stdout: '', stderr: error?.message || String(error) }));
      if (probe.code !== 0) return result('UNAVAILABLE', (probe.stderr || 'Registered local worker executable was not found.').slice(0, 500));
      return result('READY', 'Registered local worker executable is available.', { resolvedCommand: (probe.stdout || '').split(/\r?\n/)[0] || provider.command });
    }

    if (provider.mode === 'openai-compatible' || provider.mode === 'remote-mcp') {
      if (!provider.baseUrl) return result('NOT_CONFIGURED', 'Provider Base URL is missing.');
      if (provider.mode === 'openai-compatible' && !provider.defaultModel) return result('NOT_CONFIGURED', 'Provider model is missing.');
      if (provider.requiresCredential && !provider.apiKey) return result('AUTH_REQUIRED', 'A configured provider credential could not be loaded.');
      if (!opts.networkApproved) return result('DEGRADED', 'Live endpoint health was not probed because NETWORK approval was not granted.');
      if (provider.apiKey && !opts.credentialApproved) return result('AUTH_REQUIRED', 'Live endpoint health requires explicit CREDENTIAL approval.');
      if (typeof this.fetchImpl !== 'function') return result('UNAVAILABLE', 'No fetch implementation is available for provider health.');

      const base = safeNetworkUrl(provider.baseUrl);
      const baseHref = base.href.endsWith('/') ? base.href : base.href + '/';
      const endpoint = provider.mode === 'remote-mcp'
        ? base
        : new URL(String(provider.modelsPath || 'models').replace(/^\/+/, ''), baseHref);
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(30000, Math.max(1000, Number(opts.timeoutMs || 5000))));
      const externalAbort = () => controller.abort();
      if (opts.signal) opts.signal.aborted ? controller.abort() : opts.signal.addEventListener('abort', externalAbort, { once: true });
      try {
        const headers = { accept: 'application/json' };
        if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
        const response = await this.fetchImpl(endpoint, { method: 'GET', headers, signal: controller.signal });
        if (response.status === 401 || response.status === 403) return result('AUTH_REQUIRED', `Endpoint returned HTTP ${response.status}.`, { endpoint: endpoint.href });
        if (!response.ok) return result('DEGRADED', `Endpoint returned HTTP ${response.status}.`, { endpoint: endpoint.href });
        return result('READY', 'Provider endpoint responded successfully.', { endpoint: endpoint.href });
      } catch (error) {
        if (error?.name === 'AbortError') return result('UNAVAILABLE', timedOut ? 'Provider health probe timed out.' : 'Provider health probe was cancelled.');
        return result('UNAVAILABLE', String(error?.message || error).slice(0, 500));
      } finally {
        clearTimeout(timeout);
        if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
      }
    }

    return result('UNAVAILABLE', `Unsupported provider mode: ${provider.mode}`);
  }

  resolve(role, preferred) {
    const ids = preferred ? [preferred] : Object.keys(this.registry);
    for (const id of ids) {
      const provider = this.registry[id];
      if (provider && normalizeRoles(provider).includes(role)) return { id, ...provider };
    }
    return null;
  }

  capabilities(role, preferred, { model } = {}) {
    const provider = this.resolve(role, preferred);
    if (!provider) return null;
    const selectedModel = model || provider.defaultModel || '';
    const localOpenCode = provider.id === 'opencode' && modelLooksLocal(selectedModel);
    return {
      provider: provider.id,
      role,
      mode: provider.mode,
      process: provider.mode !== 'openai-compatible',
      network: localOpenCode ? false : Boolean(provider.network || provider.mode === 'openai-compatible'),
      credential: Boolean(provider.credential || provider.apiKey || provider.requiresCredential),
      local: provider.mode === 'ollama' || provider.mode === 'local-command' || provider.mode === 'codex-cli' || localOpenCode,
      workerId: provider.workerId || null,
      workerName: provider.workerName || null,
      providerName: provider.providerName || provider.id
    };
  }

  commandSpec(providerId, role, prompt, { model, cwd, providerVersion = '' } = {}) {
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
    if (provider.mode === 'codex-cli' || provider.id === 'codex') {
      const args = ['exec', '--ephemeral'];
      if (provider.id === 'codex') args.push('--ignore-user-config');
      args.push('--ignore-rules', '--sandbox', 'workspace-write', '--json');
      if (cwd) args.push('--cd', cwd);
      args.push('-c', 'sandbox_workspace_write.network_access=false');
      if (selectedModel) args.push('--model', selectedModel);
      args.push(prompt);
      return {
        command: provider.command,
        args,
        env: { ...(provider.runtimeEnv || {}) },
        provider: provider.id,
        providerName: provider.providerName || provider.id,
        workerId: provider.workerId || provider.id,
        workerName: provider.workerName || provider.id,
        codexHome: provider.codexHome || null,
        model: selectedModel || null,
        cwd: cwd || null
      };
    }
    if (provider.id === 'claude') {
      const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'plan', '--max-turns', '12'];
      if (selectedModel) args.push('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    if (provider.id === 'opencode') {
      const major = parseMajor(providerVersion);
      const args = ['run'];
      if (major < 2) args.push('--auto');
      args.push('--format', 'json');
      if (cwd) args.push('--dir', cwd);
      if (selectedModel) args.push('--model', selectedModel);
      args.push(prompt);
      return {
        command: provider.command,
        args,
        env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeBoundedConfig(providerVersion)) },
        provider: provider.id,
        model: selectedModel || null,
        cwd: cwd || null
      };
    }
    if (provider.id === 'gemini') {
      const args = ['--approval-mode', 'plan', '-p', prompt];
      if (selectedModel) args.push('--model', selectedModel);
      return { command: provider.command, args, provider: provider.id, model: selectedModel || null, cwd: cwd || null };
    }
    throw new Error(`Unsupported provider mode: ${provider.mode}`);
  }

  async execute(role, prompt, opts = {}) {
    const provider = this.resolve(role, opts.provider);
    if (!provider) throw new Error(`No provider for role: ${role}`);
    const started = Date.now();
    let selectedModel = opts.model || provider.defaultModel || process.env[`AECP_${provider.id.toUpperCase()}_MODEL`] || null;
    try {
      let result;
      if (provider.mode === 'openai-compatible') {
        result = await executeOpenAICompatible(provider, role, prompt, opts);
        selectedModel = result.model || selectedModel;
      } else {
        let providerVersion = opts.providerVersion || '';
        if (provider.id === 'opencode' && !providerVersion) {
          const versionResult = await this.runner(provider.command, ['--version'], { cwd: opts.cwd, timeoutMs: 5000, signal: opts.signal, maxOutputBytes: 4096 });
          if (versionResult.code !== 0) throw new Error('Unable to determine OpenCode version for bounded permission policy.');
          providerVersion = versionResult.stdout || versionResult.stderr;
        }
        const spec = this.commandSpec(provider.id, role, prompt, { ...opts, providerVersion });
        selectedModel = spec.model || selectedModel;
        const env = { ...(spec.env || {}), ...(opts.env || {}) };
        result = {
          ...await this.runner(spec.command, spec.args, { ...opts, env }),
          provider: spec.provider,
          providerName: spec.providerName || provider.providerName || spec.provider,
          workerId: spec.workerId || provider.workerId || null,
          workerName: spec.workerName || provider.workerName || null,
          codexHome: spec.codexHome || provider.codexHome || null,
          model: spec.model,
          command: spec.command
        };
      }
      await this.recordMetric({
        schema: 'aecp.provider-usage/v1',
        provider: provider.id,
        role,
        model: selectedModel,
        success: result.code === 0,
        code: result.code,
        timedOut: Boolean(result.timedOut),
        aborted: Boolean(result.aborted),
        latencyMs: Math.max(0, Date.now() - started),
        usage: sanitizeNumericMetadata(result.usage),
        recordedAt: new Date().toISOString()
      });
      return result;
    } catch (error) {
      await this.recordMetric({
        schema: 'aecp.provider-usage/v1',
        provider: provider.id,
        role,
        model: selectedModel,
        success: false,
        code: error?.code || 'ERROR',
        timedOut: error?.code === 'PROVIDER_TIMEOUT',
        aborted: error?.name === 'AbortError',
        latencyMs: Math.max(0, Date.now() - started),
        usage: null,
        recordedAt: new Date().toISOString()
      });
      throw error;
    }
  }
}

module.exports = { ProviderRouter, PROVIDERS, run, safeNetworkUrl, executeOpenAICompatible, parseMajor, openCodeBoundedConfig, modelLooksLocal, sanitizeNumericMetadata };
