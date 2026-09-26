'use strict';

// Main-process argument validation for every IPC channel (Blueprint 04 Electron baseline).
// The renderer is treated as untrusted input: each channel declares exactly what it accepts,
// invalid calls are rejected with a fixed error that never echoes the payload, and the
// handler is not invoked.

const { SETTINGS_AGENT_IDS, EFFORTS } = require('./agent-settings.cjs');

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Internal options that only the main process may set on Harness, Autonomy and Mission runs.
const RESERVED_RUN_KEYS = new Set([
  'sourceRoot', 'workspaceId', 'runRoot', 'signal', 'executionApproved', 'providerRouter', 'policy', 'onEvent',
  'permissionPolicy', 'preparedWorktree', 'preparedBaseHead', 'baseRef'
]);
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_TEXT = 64 * 1024;
const MAX_DEPTH = 5;

class IpcValidationError extends Error {
  constructor(channel, code) {
    super('Invalid IPC request.');
    this.name = 'IpcValidationError';
    this.code = code;
    this.channel = channel;
  }
}

const fail = (channel, code) => { throw new IpcValidationError(channel, code); };
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function checkGeneric(channel, value, depth = 0) {
  if (depth > MAX_DEPTH) fail(channel, 'DEPTH');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(channel, 'NUMBER'); return; }
  if (typeof value === 'string') { if (value.length > MAX_TEXT) fail(channel, 'TEXT_TOO_LONG'); return; }
  if (Array.isArray(value)) {
    if (value.length > 256) fail(channel, 'ARRAY_TOO_LONG');
    for (const item of value) checkGeneric(channel, item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) fail(channel, 'TYPE');
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail(channel, 'FORBIDDEN_KEY');
    checkGeneric(channel, value[key], depth + 1);
  }
}

const field = {
  id: (opt = false) => ({ kind: 'id', opt }),
  str: (max = 4096, opt = false) => ({ kind: 'str', max, opt }),
  text: (opt = false) => ({ kind: 'str', max: MAX_TEXT, opt }),
  int: (min, max, opt = false) => ({ kind: 'int', min, max, opt }),
  num: (min, max, opt = false) => ({ kind: 'num', min, max, opt }),
  bool: (opt = true) => ({ kind: 'bool', opt }),
  oneOf: (values, opt = false) => ({ kind: 'enum', values, opt }),
  strList: (maxItems = 64, maxLen = 128, opt = true) => ({ kind: 'strList', maxItems, maxLen, opt })
};

function checkField(channel, spec, value) {
  if (value === undefined || value === null) {
    if (spec.opt) return;
    fail(channel, 'MISSING_FIELD');
  }
  switch (spec.kind) {
    case 'id': if (typeof value !== 'string' || !ID.test(value)) fail(channel, 'ID'); return;
    case 'str': if (typeof value !== 'string' || value.length > spec.max) fail(channel, 'STRING'); return;
    case 'int': if (!Number.isInteger(value) || value < spec.min || value > spec.max) fail(channel, 'INTEGER'); return;
    case 'num': if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) fail(channel, 'NUMBER'); return;
    case 'bool': if (typeof value !== 'boolean') fail(channel, 'BOOLEAN'); return;
    case 'enum': if (!spec.values.includes(value)) fail(channel, 'ENUM'); return;
    case 'strList':
      if (!Array.isArray(value) || value.length > spec.maxItems || value.some(x => typeof x !== 'string' || x.length > spec.maxLen)) fail(channel, 'LIST');
      return;
    default: fail(channel, 'SCHEMA');
  }
}

// none: the channel takes no payload. strict: exactly these fields. open: known fields are typed, the
// rest must be bounded plain data and must not use reserved internal keys.
const none = () => ({ mode: 'none' });
const strict = fields => ({ mode: 'strict', fields });
const open = (fields, { requireFields = false } = {}) => ({ mode: 'open', fields, requireFields });

function validatePayload(channel, schema, payload) {
  if (!schema) fail(channel, 'NO_SCHEMA');
  if (schema.mode === 'none') {
    if (payload !== undefined && payload !== null) fail(channel, 'UNEXPECTED_PAYLOAD');
    return payload;
  }
  if (payload === undefined || payload === null) {
    if (schema.mode === 'open' && !schema.requireFields) return payload;
    fail(channel, 'MISSING_PAYLOAD');
  }
  if (!isPlainObject(payload)) fail(channel, 'TYPE');
  let size;
  try { size = Buffer.byteLength(JSON.stringify(payload), 'utf8'); } catch { fail(channel, 'SERIALIZE'); }
  if (size > MAX_PAYLOAD_BYTES) fail(channel, 'TOO_LARGE');
  for (const key of Object.keys(payload)) if (FORBIDDEN_KEYS.has(key)) fail(channel, 'FORBIDDEN_KEY');
  for (const [name, spec] of Object.entries(schema.fields)) checkField(channel, spec, payload[name]);
  for (const key of Object.keys(payload)) {
    if (schema.fields[key]) continue;
    if (schema.mode === 'strict') fail(channel, 'UNKNOWN_FIELD');
    if (RESERVED_RUN_KEYS.has(key)) fail(channel, 'RESERVED_FIELD');
    checkGeneric(channel, payload[key]);
  }
  return payload;
}

const RISKS = ['GREEN', 'YELLOW', 'RED'];
const BUDGET = () => field.num(0, 1e15, true);
const BUDGETS = {
  maxTasks: BUDGET(), maxIterations: BUDGET(), maxTurns: BUDGET(), maxFailedAttempts: BUDGET(),
  maxNoProgressAttempts: BUDGET(), maxWallClockMs: BUDGET(), maxProviderReportedCost: BUDGET(),
  maxLocalComputeMs: BUDGET(), maxChangedFiles: BUDGET(), maxPatchBytes: BUDGET(), checkpointEvery: BUDGET()
};

const NONE_CHANNELS = [
  'app:info', 'backup:export', 'backup:restore', 'data:clear-evidence', 'data:remove-workspace', 'data:clear-credentials',
  'data:reset-state', 'state:get', 'policy:get', 'security:adapter-matrix', 'workspace:select', 'workspace:refresh',
  'workspace:add-repo', 'workspace:open', 'workspace:terminal', 'chatgpt:open', 'control-plane:status',
  'control-plane:remote-pair', 'control-plane:remote-devices', 'harness:status', 'harness:cancel', 'autonomy:options',
  'autonomy:status', 'autonomy:resume', 'autonomy:cancel', 'autonomy:open-worktree', 'autonomy:apply', 'mcp:status',
  'mcp:start', 'mcp:stop', 'mcp:copy-connection', 'agents:list', 'python:syntax-scan', 'desktop:list-windows',
  'desktop:list-browser-windows', 'github:connection', 'github:connect', 'update:check', 'update:status', 'update:apply',
  'update:rollback', 'update:open-release', 'tools:detect', 'clipboard:read', 'task:sample', 'task:list', 'provider:list',
  'worker:list', 'worker:login-official', 'agents:settings:get'
];

const IPC_SCHEMAS = Object.freeze({
  ...Object.fromEntries(NONE_CHANNELS.map(channel => [channel, none()])),
  'guidance:recommend': open({ chatgptOpened: field.bool() }),
  'policy:save': strict({ maxRisk: field.oneOf(RISKS, true), requireApprovalFor: field.strList(32, 32) }),
  'harness:start': open({
    goal: field.text(true), done: field.text(true), context: field.text(true), ...BUDGETS,
    plannerProvider: field.str(128, true), builderProvider: field.str(128, true), reviewerProvider: field.str(128, true),
    plannerModel: field.str(256, true), builderModel: field.str(256, true), reviewerModel: field.str(256, true),
    providerNetworkApproved: field.bool(), providerCredentialApproved: field.bool()
  }),
  'control-plane:replay': strict({ runId: field.id(true), limit: field.int(1, 5000, true) }),
  'control-plane:events': strict({ limit: field.int(1, 5000, true) }),
  'control-plane:remote-revoke': strict({ deviceId: field.id() }),
  'control-plane:create-mission': open({
    goal: field.text(), done: field.text(), builderWorkers: field.strList(16, 128), maxConcurrency: BUDGET(),
    ...BUDGETS, delivery: field.bool(), autoStart: field.bool()
  }, { requireFields: true }),
  'control-plane:start': strict({ runId: field.id() }),
  'control-plane:pause': strict({ runId: field.id() }),
  'control-plane:cancel': strict({ runId: field.id() }),
  'control-plane:cancel-task': strict({ runId: field.id(), taskId: field.id() }),
  'control-plane:approve': strict({ approvalId: field.id(), note: field.str(2048, true) }),
  'control-plane:reject': strict({ approvalId: field.id(), note: field.str(2048, true) }),
  'control-plane:approve-delivery': strict({ runId: field.id(), taskId: field.id(), by: field.str(64, true), note: field.str(2048, true) }),
  'autonomy:start': open({
    goal: field.text(), done: field.text(), workerId: field.str(128, true), verificationProfile: field.str(128, true),
    maxIterations: BUDGET(), iterationTimeoutSeconds: BUDGET(), checkpointEvery: BUDGET()
  }, { requireFields: true }),
  'agents:launch': strict({ agentId: field.id() }),
  // Agent ids and reasoning efforts are whitelists; an empty string clears a setting; the model name is pattern-checked in the handler.
  'agents:settings:set': strict({ agentId: field.oneOf(SETTINGS_AGENT_IDS), model: field.str(120, true), effort: field.oneOf([...EFFORTS, ''], true) }),
  'agents:say-hi': strict({ agentId: field.oneOf(SETTINGS_AGENT_IDS), model: field.str(120, true) }),
  'desktop:inspect-ui': strict({ pid: field.int(1, 4294967295), maxNodes: field.int(1, 1000, true) }),
  'desktop:dock-browser': strict({ pid: field.int(1, 4294967295), side: field.oneOf(['left', 'right']) }),
  'clipboard:write': strict({ text: field.str(128 * 1024) }),
  'task:import': strict({ text: field.text() }),
  'task:execute': strict({ taskId: field.id() }),
  'task:trace': strict({ taskId: field.id() }),
  'task:evidence': strict({ taskId: field.id() }),
  'provider:health': open({
    providerId: field.id(), model: field.str(256, true), networkApproved: field.bool(), credentialApproved: field.bool()
  }, { requireFields: true }),
  'provider:save': open({
    name: field.str(256), kind: field.str(64), baseUrl: field.str(2048, true), defaultModel: field.str(256, true),
    wireApi: field.str(32, true), command: field.str(1024, true), args: field.str(4096, true), apiKey: field.str(8192, true)
  }, { requireFields: true }),
  'provider:delete': strict({ providerId: field.id() })
});

// Wrap ipcMain so every channel must have a declared schema and is validated before its handler runs.
// senderAllowed is optional defence in depth: when the sender frame is known and is not the packaged UI,
// the request is rejected.
function createValidatedIpc(ipcMain, schemas = IPC_SCHEMAS, { senderAllowed = null } = {}) {
  return {
    handle(channel, handler) {
      if (!schemas[channel]) throw new Error(`IPC channel "${channel}" has no validation schema.`);
      ipcMain.handle(channel, async (event, ...args) => {
        if (senderAllowed && !senderAllowed(event)) throw new IpcValidationError(channel, 'SENDER');
        if (args.length > 1) throw new IpcValidationError(channel, 'EXTRA_ARGUMENTS');
        const payload = validatePayload(channel, schemas[channel], args[0]);
        return handler(event, payload);
      });
    }
  };
}

module.exports = { IPC_SCHEMAS, IpcValidationError, createValidatedIpc, validatePayload, field, ID, RESERVED_RUN_KEYS, MAX_PAYLOAD_BYTES };
