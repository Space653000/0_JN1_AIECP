'use strict';

const { redactText } = require('./redaction.cjs');

// Per-agent model and reasoning-effort settings, plus the fixed "say hi" probe (work order 0019).
// Everything here is additive: with no settings stored, every value falls back to what AIECP did before.

const CLI_AGENT_IDS = Object.freeze(['codex-cli', 'claude-code', 'gemini-cli', 'opencode', 'ollama']);
const WORKER_AGENT_IDS = Object.freeze(['codex-official', 'codex-pega']);
const SETTINGS_AGENT_IDS = Object.freeze([...CLI_AGENT_IDS, ...WORKER_AGENT_IDS]);
// Effort levels per agent, as the tools themselves define them: Codex model_reasoning_effort, `claude --effort` (from claude --help)
// and `ollama run --think` (thinking models only). Leaving a setting empty passes no flag at all.
// Codex: the account's own models_cache.json lists low/medium/high/xhigh and, on newer models, max and ultra; the
// card narrows this whitelist to the levels the chosen model reports. Ollama: "true" is plain on/off thinking.
const CODEX_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const EFFORT_LEVELS = Object.freeze({
  'codex-official': CODEX_EFFORTS,
  'codex-pega': CODEX_EFFORTS,
  'claude-code': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  ollama: Object.freeze(['low', 'medium', 'high', 'true'])
});
const EFFORTS = Object.freeze([...new Set(Object.values(EFFORT_LEVELS).flat())]);
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

// Anthropic's own maintained aliases for Claude Code: they always resolve to the current latest generation of that
// tier, so they never go stale the way a frozen model id would. This is not this project's own frozen model list.
const CLAUDE_MODEL_ALIASES = Object.freeze(['sonnet', 'opus', 'fable']);

// `opencode models` prints one `provider/model` per line (blank/log lines are dropped); that shape is exactly
// what its own --model flag takes, so no translation is needed between the list and the flag.
function parseOpenCodeModels(output) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => MODEL_PATTERN.test(line))
    .slice(0, 200);
}

// Codex keeps the model list it fetched for the signed-in account in <CODEX_HOME>/models_cache.json. Only the
// models Codex itself would list (visibility "list") are offered, in Codex's own priority order, each with the
// reasoning levels that model really supports. Nothing is invented: an unreadable cache gives an empty list.
const EFFORT_WORD = /^[a-z]{2,16}$/;
function parseCodexModelsCache(text) {
  let parsed;
  try { parsed = JSON.parse(String(text || '')); } catch { return []; }
  const list = Array.isArray(parsed?.models) ? parsed.models : [];
  return list
    .filter((m) => m && m.visibility === 'list' && MODEL_PATTERN.test(String(m.slug || '')))
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
    .slice(0, 100)
    .map((m) => {
      const efforts = (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
        .map((level) => String(level?.effort ?? level ?? ''))
        .filter((level) => EFFORT_WORD.test(level));
      const name = String(m.display_name || m.slug).slice(0, 80);
      const defaultEffort = EFFORT_WORD.test(String(m.default_reasoning_level || '')) ? m.default_reasoning_level : null;
      return { slug: m.slug, name, efforts, defaultEffort };
    });
}

// `ollama show <model>` prints a Capabilities section; a thinking model lists "thinking" and may add a
// "levels  false, true" (on/off) or "levels  low, medium, high" line. The result is the list of --think values
// that model accepts: [] = it cannot think at all; null = no Capabilities section, so nothing is known.
function parseOllamaShowThinking(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'Capabilities');
  if (start < 0) return null;
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    section.push(line.trim());
  }
  if (!section.some((line) => line.split(/\s+/)[0] === 'thinking')) return [];
  const levelsLine = section.find((line) => line.startsWith('levels'));
  if (!levelsLine) return ['true'];
  const values = levelsLine.replace(/^levels\s*/, '').split(',').map((value) => value.trim()).filter(Boolean);
  const words = values.filter((value) => EFFORT_LEVELS.ollama.includes(value) && value !== 'true');
  if (words.length) return words;
  return values.includes('true') ? ['true'] : [];
}

// The --think value to actually send for an Ollama model: the chosen one when the model accepts it, plain "on"
// when the model only has on/off, nothing at all when the model cannot think. Unknown capabilities change nothing.
function ollamaThinkFor(options, effort) {
  if (!effort || !Array.isArray(options)) return effort || null;
  if (options.includes(effort)) return effort;
  if (options.includes('true')) return 'true';
  return null;
}

const SAY_HI_PROMPT = 'Reply with one short greeting sentence.';
const SAY_HI_TIMEOUT_MS = 60 * 1000;
const SAY_HI_REPLY_BYTES = 2048;
const SAY_HI_RUN_OUTPUT_BYTES = 256 * 1024;
const REASON_CHARS = 600;

const effortsFor = (agentId) => EFFORT_LEVELS[agentId] || [];
const supportsEffort = (agentId) => effortsFor(agentId).length > 0;
const validModel = (value) => typeof value === 'string' && MODEL_PATTERN.test(value);
const validEffort = (value, agentId) => typeof value === 'string' && (agentId ? effortsFor(agentId) : EFFORTS).includes(value);

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
    else if (validEffort(patch.effort, agentId)) out.effort = patch.effort;
    else throw new Error('Effort must be one of: ' + effortsFor(agentId).join(', ') + '.');
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
    if (validEffort(entry.effort, agentId)) clean.effort = entry.effort;
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
  return { model, modelSource, effort: own.effort || null, effortSupported: supportsEffort(agentId), efforts: [...effortsFor(agentId)] };
}

// Strips terminal control sequences a CLI's own progress bar/spinner writes (e.g. Ollama's "pulling manifest"
// spinner), so a failure reason or reply never carries raw escape codes into the UI.
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '').replace(/\r/g, '');
}

// A spinner that reprints the same short phrase (Ollama's "pulling manifest", "verifying sha256 digest", ...)
// leaves that phrase sitting next to itself many times once the escape codes that repositioned the cursor are
// gone. Collapsing 3+ back-to-back repeats of the same short phrase to one keeps the message readable.
function collapseRepeatedPhrases(value) {
  return String(value || '').replace(/\b(\w[\w .]{1,40}?)\b(?:[^\w]{0,3}\1\b){2,}/gi, '$1');
}

// The reply text out of whatever a CLI printed: one JSON document, JSON lines, or plain text.
function extractReply(stdout) {
  const text = stripAnsi(stdout).trim();
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

// Claude Code prints a JSON result with is_error true (and exit code 0) when, for example, the login has expired; its message is the real reason.
// A JSON string that is itself an encoded error (Codex nests its real message this way) is unwrapped one level.
function unwrapMessage(value) {
  if (typeof value !== 'string') return typeof value === 'string' ? value : '';
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    try {
      const inner = JSON.parse(trimmed);
      const found = inner?.error?.message || inner?.message;
      if (typeof found === 'string' && found) return unwrapMessage(found);
    } catch { /* not nested JSON; use the string as it is */ }
  }
  return value;
}

// Finds a real, structured failure message in a CLI's own JSON/JSONL output, so noise on stderr (Codex always
// prints "Reading additional input from stdin..." there once it starts, whether or not the run fails) never
// hides it. Recognizes Claude Code's {"is_error":true,"result":...} and Codex's {"type":"turn.failed"|"error"}.
function jsonError(stdout) {
  const text = String(stdout || '').trim();
  const candidates = [text, ...text.split(String.fromCharCode(10)).reverse()];
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.is_error === true) return String(typeof parsed.result === 'string' && parsed.result ? parsed.result : 'The agent reported an error.');
      if (parsed.type === 'turn.failed' || parsed.type === 'error') {
        const raw = parsed.error?.message ?? parsed.message;
        const found = unwrapMessage(raw);
        if (found) return found;
      }
    } catch { /* not JSON */ }
  }
  return '';
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
        // A structured error inside the CLI's own JSON output is the real reason; stderr may just be routine
        // status noise (Codex always writes "Reading additional input from stdin..." there once it starts).
        const detail = redactText(collapseRepeatedPhrases(stripAnsi(jsonError(outcome?.stdout) || outcome?.stderr || outcome?.stdout || 'The agent failed without a message.'))).trim();
        return { ...base, model: usedModel, ok: false, code: 'FAILED', reason: detail.slice(-REASON_CHARS), reply: '', durationMs };
      }
      const agentError = jsonError(outcome.stdout);
      if (agentError) return { ...base, model: usedModel, ok: false, code: 'FAILED', reason: redactText(agentError).trim().slice(-REASON_CHARS), reply: '', durationMs };
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
  CLI_AGENT_IDS, WORKER_AGENT_IDS, SETTINGS_AGENT_IDS, EFFORTS, MODEL_PATTERN, MODEL_ENV, CLAUDE_MODEL_ALIASES, parseOpenCodeModels, parseCodexModelsCache, parseOllamaShowThinking, ollamaThinkFor, CODEX_EFFORTS,
  SAY_HI_PROMPT, SAY_HI_TIMEOUT_MS, SAY_HI_REPLY_BYTES, SAY_HI_RUN_OUTPUT_BYTES,
  EFFORT_LEVELS, effortsFor, supportsEffort, validModel, validEffort, cleanPatch, readSettings, applyPatch, effective, extractReply, stripAnsi, collapseRepeatedPhrases, SayHiService
};
