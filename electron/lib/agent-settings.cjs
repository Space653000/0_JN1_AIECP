'use strict';

const { redactText } = require('./redaction.cjs');

// Per-agent model and reasoning-effort settings, plus the fixed "say hi" probe (work order 0019).
// Everything here is additive: with no settings stored, every value falls back to what AIECP did before.

const CLI_AGENT_IDS = Object.freeze(['codex-cli', 'claude-code', 'gemini-cli', 'opencode', 'ollama']);
const WORKER_AGENT_IDS = Object.freeze(['codex-official', 'codex-pega']);
const SETTINGS_AGENT_IDS = Object.freeze([...CLI_AGENT_IDS, ...WORKER_AGENT_IDS]);
const EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

// Environment variables that already choose a model today (see provider-router.cjs and main.cjs).
const MODEL_ENV = Object.freeze({
  'codex-official': 'AECP_CODEX_OFFICIAL_MODEL',
  'codex-pega': 'AECP_PEGA_MODEL',
  'codex-cli': 'AECP_CODEX_MODEL',
  'claude-code': 'AECP_CLAUDE_MODEL',
  'gemini-cli': 'AECP_GEMINI_MODEL',
  opencode: 'AECP_OPENCODE_MODEL',
  ollama: 'AECP_OLLAMA_MODEL'
});

const SAY_HI_PROMPT = 'Reply with one short greeting sentence.';
const SAY_HI_TIMEOUT_MS = 60 * 1000;
const SAY_HI_REPLY_BYTES = 2048;
const SAY_HI_RUN_OUTPUT_BYTES = 256 * 1024;
const REASON_CHARS = 600;

const supportsEffort = (agentId) => WORKER_AGENT_IDS.includes(agentId);
const validModel = (value) => typeof value === 'string' && MODEL_PATTERN.test(value);
const validEffort = (value) => typeof value === 'string' && EFFORTS.includes(value);

function assertAgentId(agentId) {
  if (typeof agentId !== 'string' || !SETTINGS_AGENT_IDS.includes(agentId)) throw new Error('Unsupported agent.');
  return agentId;
}

// A patch from the renderer: undefined leaves a field alone, null or "" clears it, anything else must pass the whitelist.
function cleanPatch(agentId, patch = {}) {
  assertAgentId(agentId);
  const out = {};
  if (patch.model !== undefined) {
    if (patch.model === null || patch.model === '') out.model = null;
    else if (validModel(patch.model)) out.model = patch.model;
    else throw new Error('Model name is not allowed (letters, digits and . _ : / - only, up to 120 characters).');
  }
  if (patch.effort !== undefined) {
    if (patch.effort === null || patch.effort === '') out.effort = null;
    else if (!supportsEffort(agentId)) throw new Error('This agent does not support a reasoning effort setting.');
    else if (validEffort(patch.effort)) out.effort = patch.effort;
    else throw new Error('Reasoning effort must be one of: ' + EFFORTS.join(', ') + '.');
  }
  return out;
}

// What state.json holds under agentSettings, reduced to values that are still valid; anything else is ignored.
function readSettings(raw) {
  const settings = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings;
  for (const agentId of SETTINGS_AGENT_IDS) {
    const entry = raw[agentId];
    if (!entry || typeof entry !== 'object') continue;
    const clean = {};
    if (validModel(entry.model)) clean.model = entry.model;
    if (supportsEffort(agentId) && validEffort(entry.effort)) clean.effort = entry.effort;
    if (Object.keys(clean).length) settings[agentId] = clean;
  }
  return settings;
}

function applyPatch(current, agentId, patch) {
  const next = readSettings(current);
  const merged = { ...(next[agentId] || {}) };
  for (const [key, value] of Object.entries(cleanPatch(agentId, patch))) {
    if (value === null) delete merged[key]; else merged[key] = value;
  }
  if (Object.keys(merged).length) next[agentId] = merged; else delete next[agentId];
  return next;
}

// The model and effort that take effect for one agent, and where the model came from.
function effective(agentId, { settings = {}, env = process.env, providerModel = null } = {}) {
  assertAgentId(agentId);
  const own = settings[agentId] || {};
  const fromEnv = String(env?.[MODEL_ENV[agentId]] || '').trim().slice(0, 200) || null;
  const fromProvider = agentId === 'codex-pega' ? (String(providerModel || '').trim().slice(0, 200) || null) : null;
  let model = null;
  let modelSource = 'default';
  if (own.model) { model = own.model; modelSource = 'settings'; }
  else if (fromProvider) { model = fromProvider; modelSource = 'provider'; }
  else if (fromEnv) { model = fromEnv; modelSource = 'env'; }
  return { model, modelSource, effort: own.effort || null, effortSupported: supportsEffort(agentId) };
}

// The reply text out of whatever a CLI printed: one JSON document, JSON lines, or plain text.
function extractReply(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';
  const pick = (value, depth = 0) => {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object' || depth > 4) return '';
    if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) { const found = pick(value[i], depth + 1); if (found) return found; } return ''; }
    for (const key of ['result', 'response', 'output_text', 'text', 'message', 'content', 'item', 'part']) {
      if (value[key] !== undefined) { const found = pick(value[key], depth + 1); if (found) return found; }
    }
    return '';
  };
  try { const whole = pick(JSON.parse(text)); if (whole) return whole; } catch { /* not one JSON document */ }
  let last = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try { const found = pick(JSON.parse(trimmed)); if (found) last = found; } catch { /* a plain text line */ }
  }
  return last || text;
}

const clip = (value, bytes) => {
  const buffer = Buffer.from(String(value || ''), 'utf8');
  if (buffer.length <= bytes) return String(value || '');
  return buffer.subarray(0, bytes).toString('utf8').replace(/�$/, '') + '…';
};

// One "say hi" at a time per agent. The executor does the actual call; this class owns the limits and the result shape.
class SayHiService {
  constructor({ execute, now = Date.now } = {}) {
    if (typeof execute !== 'function') throw new Error('SayHiService requires an executor.');
    this.execute = execute;
    this.now = now;
    this.active = new Set();
  }

  async run({ agentId, agentName, model = null }) {
    assertAgentId(agentId);
    if (model !== null && model !== undefined && model !== '' && !validModel(model)) throw new Error('Model name is not allowed.');
    const base = { agentId, agentName: agentName || agentId, model: model || null, prompt: SAY_HI_PROMPT };
    if (this.active.has(agentId)) return { ...base, ok: false, code: 'BUSY', reason: 'A greeting for this agent is already in progress.', reply: '', durationMs: 0 };
    this.active.add(agentId);
    const started = this.now();
    try {
      const outcome = await this.execute({ agentId, model: model || null, prompt: SAY_HI_PROMPT, timeoutMs: SAY_HI_TIMEOUT_MS, maxOutputBytes: SAY_HI_RUN_OUTPUT_BYTES });
      const durationMs = Math.max(0, this.now() - started);
      const usedModel = outcome?.model || model || null;
      if (outcome?.skipped) return { ...base, model: usedModel, ok: false, code: outcome.code || 'SKIPPED', reason: String(outcome.reason || '').slice(0, REASON_CHARS), reply: '', durationMs };
      if (outcome?.timedOut) return { ...base, model: usedModel, ok: false, code: 'TIMEOUT', reason: 'No answer within ' + SAY_HI_TIMEOUT_MS / 1000 + ' seconds.', reply: '', durationMs };
      if (outcome?.outputLimitExceeded) return { ...base, model: usedModel, ok: false, code: 'OUTPUT_LIMIT', reason: 'The agent printed more than the allowed amount.', reply: '', durationMs };
      if (outcome?.code !== 0) {
        const detail = redactText(String(outcome?.stderr || outcome?.stdout || 'The agent failed without a message.')).trim();
        return { ...base, model: usedModel, ok: false, code: 'FAILED', reason: detail.slice(-REASON_CHARS), reply: '', durationMs };
      }
      const reply = clip(redactText(extractReply(outcome.stdout)), SAY_HI_REPLY_BYTES);
      if (!reply) return { ...base, model: usedModel, ok: false, code: 'EMPTY', reason: 'The agent answered with nothing.', reply: '', durationMs };
      return { ...base, model: usedModel, ok: true, code: 'OK', reason: '', reply, durationMs };
    } catch (error) {
      const code = error?.code === 'APPROVAL_REQUIRED' ? 'APPROVAL_REQUIRED' : 'ERROR';
      return { ...base, ok: false, code, reason: redactText(String(error?.message || error)).slice(0, REASON_CHARS), reply: '', durationMs: Math.max(0, this.now() - started) };
    } finally {
      this.active.delete(agentId);
    }
  }
}

module.exports = {
  CLI_AGENT_IDS, WORKER_AGENT_IDS, SETTINGS_AGENT_IDS, EFFORTS, MODEL_PATTERN, MODEL_ENV,
  SAY_HI_PROMPT, SAY_HI_TIMEOUT_MS, SAY_HI_REPLY_BYTES, SAY_HI_RUN_OUTPUT_BYTES,
  supportsEffort, validModel, validEffort, cleanPatch, readSettings, applyPatch, effective, extractReply, SayHiService
};
