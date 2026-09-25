'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Marker credentials for both trust chains. They must never meet.
const GITHUB_TOKEN = 'ghp_separationmarker0123456789abcdef';
const CHATGPT_SESSION = 'chatgpt-session-cookie-marker-9f8e7d6c5b4a';
process.env.GH_TOKEN = GITHUB_TOKEN;
process.env.GITHUB_TOKEN = GITHUB_TOKEN;
process.env.CHATGPT_SESSION_TOKEN = CHATGPT_SESSION;
const fake = require('./support/update-channel-fake.cjs').install({ mode: 'good', authenticated: true });
const { loadMain } = require('./support/fake-electron-main.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const netCalls = [];
const realFetch = global.fetch;
global.fetch = (input, ...rest) => { netCalls.push(String(input?.url || input)); return realFetch(input, ...rest); };

test.before(async () => { await ctx.start(); });
test.after(() => {
  global.fetch = realFetch;
  fake.restore();
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

// Atomic-write temp files are renamed away while the tree is walked and never hold committed state.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : (/.tmp(?:-d+-d+)?$|.d+.tmp$/.test(entry.name) ? [] : [path.join(dir, entry.name)])));

test('B15-L12 opening official ChatGPT hands the browser one plain URL: no GitHub credential, no gh, no AECP request', async () => {
  const opened = ctx.record.openExternal.length;
  const ghBefore = fake.record.gh.length;
  assert.equal(await H('chatgpt:open'), true);
  assert.deepEqual(ctx.record.openExternal.slice(opened), ['https://chatgpt.com/']);
  assert.equal(fake.record.gh.length, ghBefore, 'the ChatGPT surface never touches the GitHub CLI');
  assert.deepEqual(ctx.record.clipboard, [], 'nothing was copied for the browser either');
  assert.deepEqual(netCalls, []);
});

test('B15-L12 the GitHub chain only talks to the GitHub CLI and returns no credential of any kind', async () => {
  const ghBefore = fake.record.gh.length;
  const connection = await H('github:connection');
  assert.deepEqual(connection, { connected: true, ghInstalled: true, message: 'GitHub CLI is authenticated.' });
  assert.deepEqual(fake.record.gh.slice(ghBefore), [['--version'], ['auth', 'status', '--hostname', 'github.com']], 'authentication is delegated to gh own store: only a status query, never a token read');
  assert.ok(!JSON.stringify(fake.record.gh.slice(ghBefore)).includes('token'), 'no gh command asks for or passes a token');
  const openedByGithub = ctx.record.openExternal.filter((url) => !/^https:\/\/chatgpt\.com\/$/.test(url));
  assert.deepEqual(openedByGithub, []);
  assert.deepEqual(netCalls, [], 'and AECP makes no HTTP request with a token itself');
});

test('B15-L12 GitHub sign-in is its own gh device/web flow, launched in a separate terminal, and never through the ChatGPT surface', async () => {
  fake.options.authenticated = false;
  try {
    const status = await H('github:connection');
    assert.equal(status.connected, false);
    const terminals = fake.record.terminals.length;
    const openedBefore = ctx.record.openExternal.length;
    const result = await H('github:connect');
    assert.deepEqual(result, { ok: true, alreadyConnected: false });
    assert.equal(fake.record.terminals.length, terminals + 1);
    const launched = fake.record.terminals.at(-1);
    assert.match(launched.args.join(' '), /gh auth login --hostname github\.com --web$/, 'the fixed gh browser login and nothing that accepts a pasted or reused token');
    assert.ok(!launched.args.join(' ').includes('--with-token'));
    assert.deepEqual(ctx.record.openExternal.slice(openedBefore), [], 'signing in to GitHub opens no ChatGPT page');
  } finally { fake.options.authenticated = true; }
});

test('B15-L12 neither credential ever reaches AECP storage: provider keys, state and evidence contain neither marker', async () => {
  await H('provider:save', { name: 'Chain Provider', kind: 'api', baseUrl: 'https://example.invalid/v1', defaultModel: 'm', apiKey: 'sk-provider-only-key-0123456789' });
  await H('update:check');
  const listed = JSON.stringify(await H('provider:list'));
  assert.ok(!listed.includes('sk-provider-only-key'), 'provider listings never return a key');
  const files = walk(ctx.userData);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = fs.readFileSync(file).toString('latin1');
    assert.ok(!text.includes(GITHUB_TOKEN), `${path.relative(ctx.userData, file)} must not contain the GitHub token`);
    assert.ok(!text.includes(CHATGPT_SESSION), `${path.relative(ctx.userData, file)} must not contain a ChatGPT session value`);
  }
  const stored = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'credentials.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.values).length, 1, 'the credential store holds exactly the provider key that was saved');
  assert.ok(Object.keys(stored.values).every((key) => !/github|chatgpt|gh_/i.test(key)));
  assert.deepEqual(netCalls, []);
});
