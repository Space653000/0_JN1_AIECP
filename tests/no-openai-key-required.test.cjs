'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// A clean profile on a machine that has never seen an OpenAI API key.
for (const name of Object.keys(process.env)) if (/OPENAI|AECP_.*KEY|PEGA/i.test(name)) delete process.env[name];
const { loadMain } = require('./support/fake-electron-main.cjs');
const { createUi } = require('./support/ui-harness.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const netCalls = [];
const realFetch = global.fetch;
global.fetch = (input, ...rest) => { netCalls.push(String(input?.url || input)); return realFetch(input, ...rest); };
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-nokey-'));

test.before(async () => {
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'no key needed\n');
  await ctx.start();
});
test.after(() => {
  global.fetch = realFetch;
  fs.rmSync(workspace, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('R7.5 a clean profile with no OpenAI key completes the whole guided flow: Workspace, safe task, evidence, ChatGPT', async () => {
  assert.equal(Object.keys(process.env).some((name) => /OPENAI/i.test(name)), false);
  assert.equal((await H('guidance:recommend', {})).action, 'CHOOSE_WORKSPACE');
  assert.equal((await H('provider:list')).find((provider) => provider.id === 'chatgpt-web').status, 'READY');
  ctx.control.chosenFolder = workspace;
  await H('workspace:select');
  const card = await H('task:sample');
  const task = await H('task:import', { text: JSON.stringify(card) });
  const result = await H('task:execute', { taskId: task.id });
  assert.equal(result.ok, true);
  assert.equal(result.task.state, 'DONE');
  assert.equal(result.task.result.status, 'PASS');
  assert.equal((await H('task:evidence', { taskId: task.id })).result.status, 'PASS');
  assert.equal(await H('chatgpt:open'), true);
  assert.deepEqual(ctx.record.openExternal.slice(-1), ['https://chatgpt.com/']);
  assert.equal((await H('guidance:recommend', { chatgptOpened: true })).action, 'REVIEW_EVIDENCE');
  assert.deepEqual(netCalls, [], 'nothing needed an API endpoint');
  assert.equal(fs.existsSync(path.join(ctx.userData, 'credentials.json')), false, 'no credential store was ever needed or created');
});

test('R7.5 the built-in providers never ask for a key: ChatGPT Web is READY and needs none, and the worker providers report a state instead of blocking', async () => {
  const providers = await H('provider:list');
  const chatgpt = providers.find((provider) => provider.id === 'chatgpt-web');
  assert.equal(chatgpt.hasCredential ?? false, false);
  assert.match(chatgpt.description, /No API key required/);
  assert.equal((await H('provider:health', { providerId: 'chatgpt-web' })).status, 'READY');
  for (const provider of providers.filter((item) => item.builtIn)) assert.ok(['READY', 'NOT_CONFIGURED', 'AUTH_REQUIRED', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'].includes(provider.status), `${provider.id}: ${provider.status}`);
  assert.deepEqual(netCalls, []);
});

test('R7.5 the UI never requires or prompts for an OpenAI key: the key field is optional and the Start view works without one', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const keyInput = /<input[^>]*id="providerKeyInput"[^>]*>/.exec(html)[0];
  assert.doesNotMatch(keyInput, /\brequired\b/);
  assert.match(html, /API key \(optional\)/);
  const ui = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: await H('provider:list') },
    listTasks: await H('task:list'), listProviders: await H('provider:list'), listAgents: await H('agents:list'),
    getGuidance: await H('guidance:recommend', { chatgptOpened: true })
  } });
  await ui.settle();
  const visible = [ui.el('#controlContent').innerHTML, ui.el('#providerList').innerHTML, ui.el('#agentList').innerHTML].join('\n');
  assert.doesNotMatch(visible, /OPENAI_API_KEY|API key required|enter your (?:OpenAI )?key|missing api key/i);
  assert.deepEqual(ui.prompts, [], 'no confirmation or key prompt was raised');
  assert.ok(!ui.calls.some((call) => /saveProvider|setCredential|saveKey/i.test(call.name)), 'the UI stored nothing on its own');
  assert.match(visible, /No API key required|GUIDED START|Recommended action/);
});
