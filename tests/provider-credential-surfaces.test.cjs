'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { PEGA_BASE_URL } = require('../electron/lib/pega-provider.cjs');

const ROOT = path.resolve(__dirname, '..');
const KEYS = {
  api: 'sk-CANARY-api-key-1111111111111111',
  second: 'canary-second-provider-key-22222222',
  pega: 'canary-pega-provider-key-3333333333',
  mcp: 'canary-remote-mcp-key-44444444444',
  rotated: 'canary-rotated-api-key-5555555555555'
};
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /github_pat_[A-Za-z0-9_]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"(?:api[_-]?key|apikey|password|secret|client_secret|access_token|refresh_token)"\s*:\s*"[^"\s]{8,}"/i,
  /^\s*(?:api[_-]?key|password|secret|token)\s*:\s*['"]?[A-Za-z0-9_\-+/=]{12,}/im, /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/
];

const ctx = loadMain();
const workspace = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aecp-cred-repo-'));
let providerIds = {};
const savedResponses = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const allKeys = () => Object.values(KEYS);
const ciphertexts = () => Object.values(JSON.parse(fs.readFileSync(path.join(ctx.userData, 'credentials.json'), 'utf8')).values || {});
const leaks = (text) => [...allKeys(), ...ciphertexts()].filter((secret) => text.includes(secret));

test.before(async () => {
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ providers: { company: { baseUrl: 'https://api.example.com/v1', apiKey: '' } } }));
  fs.writeFileSync(path.join(workspace, 'aecp.config.yaml'), 'provider:\n  name: company\n  api_key_ref: cred:company\n');
  await ctx.start();
  ctx.control.chosenFolder = workspace;
  await ctx.handlers['workspace:select']({});
  const save = async (payload) => { const response = await ctx.handlers['provider:save']({}, payload); savedResponses.push(JSON.stringify(response)); return response; };
  const one = await save({ name: 'Company API', kind: 'api', baseUrl: 'https://api.example.com/v1', defaultModel: 'm1', apiKey: KEYS.api });
  const two = await save({ name: 'Second API', kind: 'api', baseUrl: 'https://api.second.example/v1', defaultModel: 'm2', apiKey: KEYS.second });
  const pega = await save({ name: 'PEGA', kind: 'api', baseUrl: PEGA_BASE_URL, defaultModel: 'pega-model', wireApi: 'responses', apiKey: KEYS.pega });
  const mcp = await save({ name: 'Remote MCP', kind: 'remote-mcp', baseUrl: 'https://mcp.example.com/mcp', apiKey: KEYS.mcp });
  const rotated = await save({ id: one.id, name: 'Company API', kind: 'api', baseUrl: 'https://api.example.com/v1', defaultModel: 'm1', apiKey: KEYS.rotated });
  providerIds = { one: one.id, two: two.id, pega: pega.id, mcp: mcp.id };
  assert.equal(rotated.id, one.id);
});
test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('B03-L113 API keys of every provider route stay out of YAML/JSON files: local data, the Workspace repository, backups and the AECP repository', async () => {
  const stored = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'credentials.json'), 'utf8'));
  assert.equal(Object.keys(stored.values).length, 4, 'one encrypted credential per provider');
  assert.ok(ciphertexts().every((value) => !allKeys().some((key) => Buffer.from(value, 'base64').toString().includes(key))), 'credentials are stored only as OS-encrypted ciphertext');

  const state = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'state.json'), 'utf8'));
  assert.equal(state.providers.length >= 4, true);
  assert.ok(state.providers.filter((provider) => provider.credentialRef).every((provider) => provider.credentialRef === `cred:${provider.id}`), 'providers carry only opaque credential references');

  for (const file of walk(ctx.userData)) {
    const text = fs.readFileSync(file, 'latin1');
    assert.deepEqual(allKeys().filter((key) => text.includes(key)), [], `${path.relative(ctx.userData, file)} must not contain a plaintext key`);
    if (!file.endsWith('credentials.json')) assert.deepEqual(ciphertexts().filter((value) => text.includes(value)), [], `${path.relative(ctx.userData, file)} must not contain stored ciphertext either`);
  }
  for (const file of walk(workspace)) assert.deepEqual(leaks(fs.readFileSync(file, 'latin1')), [], `${path.relative(workspace, file)} in the Workspace repository`);

  ctx.control.savePath = path.join(ctx.userData, 'export.aecp-backup.json');
  assert.ok(await ctx.handlers['backup:export']({}), 'the backup was written');
  const backup = fs.readFileSync(ctx.control.savePath, 'utf8');
  assert.deepEqual(leaks(backup), [], 'backups never contain plaintext keys or the credential store');
  const parsed = JSON.parse(backup);
  assert.ok(parsed.files.length >= 1, 'the backup really contains files');
  assert.equal(parsed.files.some((file) => path.basename(file.path) === 'credentials.json'), false, 'the credential store is never part of a backup');
  for (const file of parsed.files) assert.deepEqual(leaks(Buffer.from(file.data, 'base64').toString('latin1')), [], `${file.path} inside the backup`);

  const tracked = execFileSync('git', ['ls-files', '*.json', '*.yml', '*.yaml'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.length >= 10);
  for (const file of tracked) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.deepEqual(SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map(String), [], `${file} looks like it contains a secret`);
  }
});

test('B03-L116 every read response returns only credential metadata, never the key, after it was saved or rotated', async () => {
  const before = 0;
  const responses = {};
  const read = async (name, ...args) => { responses[name] = JSON.stringify(await ctx.handlers[name]({}, ...args)); };
  for (const channel of ['provider:list', 'state:get', 'app:info', 'worker:list', 'policy:get', 'security:adapter-matrix', 'github:connection', 'update:status', 'task:list', 'mcp:status', 'guidance:recommend']) {
    await read(channel, channel === 'guidance:recommend' ? { chatgptOpened: false } : undefined);
  }
  for (const [label, providerId] of Object.entries(providerIds)) {
    responses[`provider:health:${label}`] = JSON.stringify(await ctx.handlers['provider:health']({}, { providerId }));
  }
  responses['provider:save (update)'] = JSON.stringify(await ctx.handlers['provider:save']({}, { id: providerIds.two, name: 'Second API', kind: 'api', baseUrl: 'https://api.second.example/v1', defaultModel: 'm2' }));
  savedResponses.forEach((text, index) => { responses[`provider:save #${index + 1}`] = text; });
  for (const [name, text] of Object.entries(responses)) assert.deepEqual(leaks(text), [], `${name} must not reveal a key or ciphertext`);

  const listed = JSON.parse(responses['provider:list']);
  for (const providerId of Object.values(providerIds)) {
    const provider = listed.find((item) => item.id === providerId);
    assert.ok(provider, providerId);
    assert.equal(provider.hasCredential, true, 'the UI is told only that a credential exists');
    assert.equal(typeof provider.hasCredential, 'boolean');
    assert.equal('apiKey' in provider || 'key' in provider || 'secret' in provider, false);
  }
  assert.equal(JSON.parse(responses['provider:save (update)']).hasCredential, true, 'updating without a key keeps the stored credential and returns metadata only');
  assert.deepEqual(leaks(ctx.record.console.slice(before).join('\n')), [], 'nothing is ever logged with a key in it');
  assert.deepEqual(ctx.record.clipboard, [], 'saving and reading providers never touches the clipboard');
});
