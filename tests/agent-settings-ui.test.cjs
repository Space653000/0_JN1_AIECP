'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi } = require('./support/ui-harness.cjs');

const efforts = { codex: ['minimal', 'low', 'medium', 'high', 'xhigh'], claude: ['low', 'medium', 'high', 'xhigh', 'max'], ollama: ['low', 'medium', 'high'] };
const row = (id, name, kind, extra = {}) => ({ id, name, kind, model: null, modelSource: 'default', effort: null, effortSupported: false, efforts: [], sayHi: { supported: true, network: true, keyConfigured: null }, ...extra });
const VIEW = {
  schema: 'aecp.agent-settings/v1',
  ollamaModels: ['qwen3:4b-instruct', 'llama3.2:3b'],
  agents: [
    { ...row('chatgpt-web', 'ChatGPT Web', 'web'), controllable: false, sayHi: { supported: false, network: false, keyConfigured: null } },
    row('codex-cli', 'Codex CLI', 'cli', { sayHi: { supported: false, network: false, keyConfigured: null } }),
    row('claude-code', 'Claude Code', 'cli', { model: 'sonnet', modelSource: 'settings', effort: 'high', effortSupported: true, efforts: efforts.claude }),
    row('gemini-cli', 'Gemini CLI', 'cli'),
    row('opencode', 'OpenCode', 'cli'),
    row('ollama', 'Local Ollama', 'local', { effortSupported: true, efforts: efforts.ollama, sayHi: { supported: true, network: false, keyConfigured: null } }),
    row('codex-official', 'Codex OFFICIAL (OpenAI Official)', 'codex-worker', { effortSupported: true, efforts: efforts.codex }),
    row('codex-pega', 'Codex PEGA', 'codex-worker', { effortSupported: true, efforts: efforts.codex, sayHi: { supported: true, network: true, keyConfigured: false } })
  ]
};
const AGENTS = [
  { id: 'chatgpt-web', name: 'ChatGPT Web', role: 'supervisor', available: true, version: 'Official web', kind: 'web' },
  { id: 'codex-cli', name: 'Codex CLI', role: 'coding', available: true, version: 'codex 1.0' },
  { id: 'claude-code', name: 'Claude Code', role: 'coding', available: true, version: 'claude 2.0' },
  { id: 'gemini-cli', name: 'Gemini CLI', role: 'research-coding', available: false, version: 'Not found' },
  { id: 'opencode', name: 'OpenCode', role: 'local-agent', available: true, version: 'opencode 1.0' },
  { id: 'ollama', name: 'Local Ollama', role: 'local-models', available: true, version: 'ollama 0.9' }
];
const base = { getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [], listAgents: AGENTS };

async function boot(responses = {}) {
  const ui = createUi({ responses: { ...base, getAgentSettings: VIEW, ...responses } });
  await ui.settle();
  return ui;
}
const html = (ui) => ui.el('#agentList').innerHTML;
const panel = (source, id) => { const start = source.indexOf(`data-agent-settings="${id}"`); return start < 0 ? '' : source.slice(start, source.indexOf('</details>', start)); };
const clickWith = (ui, selector, dataset) => ui.document.listeners.click[0]({ target: { closest: (asked) => (asked === selector ? { dataset } : null) } });
const changeWith = (ui, selector, dataset, value) => ui.document.listeners.change[0]({ target: { closest: (asked) => (asked === selector ? { dataset, value } : null) } });

test('B0019 every agent gets a small model-and-effort panel, and the workers appear as their own cards', async () => {
  const ui = await boot();
  const source = html(ui);
  for (const id of ['claude-code', 'gemini-cli', 'opencode', 'ollama', 'codex-official', 'codex-pega', 'codex-cli']) assert.ok(panel(source, id), `${id} has a panel`);
  assert.match(source, /Codex OFFICIAL \(OpenAI Official\)/, 'the OFFICIAL card is labelled so it can be recognised at a glance');
  assert.match(source, /Codex PEGA/);
  for (const id of ['claude-code', 'gemini-cli', 'opencode', 'ollama', 'codex-official', 'codex-pega']) {
    assert.match(panel(source, id), new RegExp(`data-agent-sayhi="${id}"`), `${id} has a say-hi button`);
    assert.match(panel(source, id), new RegExp(`data-agent-model="${id}"`), `${id} has a model field`);
  }
});

test('B0019 the official ChatGPT website only gets an explanation: no model or effort field and no greeting', async () => {
  const ui = await boot();
  const source = html(ui);
  assert.match(source, /data-agent-note="chatgpt-web"/);
  assert.match(source, /AIECP does not control the official website/);
  assert.equal(panel(source, 'chatgpt-web'), '');
  assert.doesNotMatch(source, /data-agent-(?:model|effort|sayhi|save)="chatgpt-web"/);
});

test('B0019 the effort control shows the levels each tool really has, "Not applicable" where there is none, and Ollama gets a thinking switch', async () => {
  const source = html(await boot());
  const claude = panel(source, 'claude-code');
  for (const level of efforts.claude) assert.match(claude, new RegExp(`<option value="${level}"`), `claude ${level}`);
  assert.match(claude, /<option value="high" selected>/, 'the stored value is preselected');
  assert.match(claude, /value="sonnet"/, 'the stored model is filled in');
  const codex = panel(source, 'codex-official');
  for (const level of efforts.codex) assert.match(codex, new RegExp(`<option value="${level}"`));
  assert.doesNotMatch(codex, /value="max"/, 'Codex has no max level');
  const ollama = panel(source, 'ollama');
  assert.match(ollama, /Thinking/);
  assert.match(ollama, /<option value="">Off<\/option>/, 'thinking defaults to off');
  assert.match(ollama, /<select data-agent-model="ollama">/, 'Ollama models come from a list');
  assert.match(ollama, /<option value="qwen3:4b-instruct"/);
  assert.match(ollama, /<option value="llama3\.2:3b"/);
  for (const id of ['gemini-cli', 'opencode']) {
    assert.match(panel(source, id), /Not applicable/, `${id} has no effort`);
    assert.doesNotMatch(panel(source, id), new RegExp(`data-agent-effort="${id}"`));
  }
  assert.match(panel(source, 'codex-cli'), /Use the Codex OFFICIAL or Codex PEGA cards/, 'plain Codex CLI points at the isolated workers');
  assert.doesNotMatch(panel(source, 'codex-cli'), /data-agent-sayhi/);
});

test('B0019 a model left unset says so instead of naming one', async () => {
  const source = html(await boot());
  assert.match(panel(source, 'gemini-cli'), /Use the default \(chosen by the tool\)/);
  assert.match(panel(source, 'gemini-cli'), /<code>—<\/code>/);
});

// A stand-in for the main process: it stores what was saved and answers with the updated view, like the real one.
function savingView(start = VIEW) {
  const saved = [];
  let view = start;
  const setAgentSettings = (agentId, patch) => {
    saved.push([agentId, patch]);
    view = { ...view, agents: view.agents.map((a) => (a.id === agentId ? { ...a, model: patch.model || null, modelSource: patch.model ? 'settings' : 'default', ...(patch.effort !== undefined ? { effort: patch.effort || null } : {}) } : a)) };
    return view;
  };
  return { saved, setAgentSettings };
}

test('B0019 switching a model or an effort is saved at once, sending only the fields the tool supports', async () => {
  const store = savingView();
  const ui = await boot({ setAgentSettings: store.setAgentSettings });
  await changeWith(ui, '[data-agent-model]', { agentModel: 'ollama' }, 'llama3.2:3b');
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(store.saved.at(-1))), ['ollama', { model: 'llama3.2:3b', effort: '' }], 'the model switch took effect without pressing Save');
  await changeWith(ui, '[data-agent-effort]', { agentEffort: 'ollama' }, 'medium');
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(store.saved.at(-1))), ['ollama', { model: 'llama3.2:3b', effort: 'medium' }]);
  assert.match(panel(html(ui), 'ollama'), /Model <code>llama3\.2:3b<\/code>/, 'the card now shows the switched model as the current one');
  await changeWith(ui, '[data-agent-model]', { agentModel: 'gemini-cli' }, 'gemini-2.5-pro');
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(store.saved.at(-1))), ['gemini-cli', { model: 'gemini-2.5-pro' }], 'no effort is sent for a tool without one');
  const before = store.saved.length;
  await clickWith(ui, '[data-agent-save]', { agentSave: 'gemini-cli' });
  await ui.settle();
  assert.equal(store.saved.length, before + 1, 'the Save button still works');
});

test('B0019 the say-hi button sends no text, shows the model, time and reply, and a failure shows its real reason', async () => {
  const calls = [];
  const answers = [
    { ok: true, agentId: 'ollama', agentName: 'Local Ollama', model: 'qwen3:4b-instruct', reply: 'Hello from the local model!', reason: '', durationMs: 1234 },
    { ok: false, agentId: 'ollama', agentName: 'Local Ollama', model: 'qwen3:4b-instruct', reply: '', reason: 'usage limit reached, try again at 2026-09-29 18:20', durationMs: 800 }
  ];
  const ui = await boot({ sayHiAgent: (...args) => { calls.push(args); return answers.shift(); } });
  assert.doesNotMatch(html(ui), /<textarea|data-agent-prompt|data-agent-message/, 'there is nowhere to type a prompt');
  await changeWith(ui, '[data-agent-model]', { agentModel: 'ollama' }, 'qwen3:4b-instruct');
  await clickWith(ui, '[data-agent-sayhi]', { agentSayhi: 'ollama' });
  await ui.settle();
  assert.deepEqual(calls, [['ollama', 'qwen3:4b-instruct']]);
  const done = panel(html(ui), 'ollama');
  assert.match(done, /Hello from the local model!/);
  assert.match(done, /qwen3:4b-instruct/);
  assert.match(done, /1\.2 s/);
  assert.match(done, /Succeeded/, 'success is stated in words, not only by colour');
  await clickWith(ui, '[data-agent-sayhi]', { agentSayhi: 'ollama' });
  await ui.settle();
  const failed = panel(html(ui), 'ollama');
  assert.match(failed, /Failed/);
  assert.match(failed, /usage limit reached, try again at 2026-09-29 18:20/, 'the reason is not swallowed');
});

test('B0019 a second press while a greeting is running does not start another one', async () => {
  const calls = [];
  let finish;
  const ui = await boot({ sayHiAgent: (...args) => { calls.push(args); return new Promise((resolve) => { finish = () => resolve({ ok: true, agentName: 'Local Ollama', model: 'm', reply: 'hi', reason: '', durationMs: 10 }); }); } });
  const first = clickWith(ui, '[data-agent-sayhi]', { agentSayhi: 'ollama' });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); // not settle(): the greeting is meant to stay pending
  assert.match(panel(html(ui), 'ollama'), /data-agent-sayhi="ollama" disabled/, 'the button is disabled while waiting');
  const second = clickWith(ui, '[data-agent-sayhi]', { agentSayhi: 'ollama' });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, 'the second press did not call the agent');
  finish();
  await Promise.all([first, second]);
  await ui.settle();
  assert.equal(calls.length, 1);
});

test('B0019 the network warning shows where a greeting leaves the computer, and a missing PEGA key blocks the button', async () => {
  const source = html(await boot());
  assert.match(panel(source, 'claude-code'), /Connects to the network and uses your account quota/);
  assert.match(panel(source, 'codex-official'), /Connects to the network and uses your account quota/);
  assert.match(panel(source, 'ollama'), /Runs locally/);
  const pega = panel(source, 'codex-pega');
  assert.match(pega, /The PEGA key is not set yet/);
  assert.match(pega, /data-agent-sayhi="codex-pega" disabled/);
  assert.match(panel(source, 'gemini-cli'), /data-agent-sayhi="gemini-cli" disabled/, 'an agent that is not installed cannot be greeted');
});

test('B0019 without the new settings data the agent list is drawn exactly as before', async () => {
  const ui = await boot({ getAgentSettings: null });
  const source = html(ui);
  assert.doesNotMatch(source, /agent-settings|data-agent-(?:model|effort|sayhi|save|note)/);
  assert.equal((source.match(/class="agent-item"/g) || []).length, AGENTS.length, 'the same six cards');
  assert.match(source, /Claude Code/);
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });

const CODEX_LIST = {
  knownModels: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'],
  knownModelLabels: { 'gpt-6-astra': 'GPT-6-Astra', 'gpt-5.6-sol': 'GPT-5.6-Sol', 'gpt-5.5': 'GPT-5.5' },
  modelEfforts: { 'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'gpt-5.5': ['low', 'medium', 'high', 'xhigh'] },
  efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
};
const withOfficial = (extra) => ({ ...VIEW, agents: VIEW.agents.map((a) => (a.id === 'codex-official' ? { ...a, ...CODEX_LIST, ...extra } : a)) });
const options = (source, attr) => [...(new RegExp('<select ' + attr + '[\\s\\S]*?</select>').exec(source)?.[0] || '').matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);

test('B0020-hotfix2 Codex OFFICIAL offers the account model list by name, and says hi with the Codex default when none is chosen', async () => {
  const ui = await boot({ getAgentSettings: withOfficial({}) });
  const card = panel(html(ui), 'codex-official');
  assert.match(card, /<option value="gpt-5\.6-sol">GPT-5\.6-Sol<\/option>/, 'the exact id is sent, the familiar name is shown');
  assert.doesNotMatch(card, /data-agent-sayhi="codex-official" disabled/, 'no model is needed: Codex has its own default');
  assert.deepEqual(options(card, 'data-agent-effort="codex-official"'), ['', 'low', 'medium', 'high', 'xhigh'], 'with the default model only the levels every model shares are offered');
});

test('B0020-hotfix2 the reasoning levels follow the chosen Codex model, and a level that model lacks is cleared on switching', async () => {
  const start = withOfficial({ model: 'gpt-6-astra', modelSource: 'settings', effort: 'ultra' });
  const store = savingView(start);
  const ui = await boot({ getAgentSettings: start, setAgentSettings: store.setAgentSettings });
  assert.deepEqual(options(panel(html(ui), 'codex-official'), 'data-agent-effort="codex-official"'), ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  await changeWith(ui, '[data-agent-model]', { agentModel: 'codex-official' }, 'gpt-5.5', 'SELECT');
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(store.saved.at(-1))), ['codex-official', { model: 'gpt-5.5', effort: '' }], 'ultra is not a GPT-5.5 level, so it is not kept');
  assert.deepEqual(options(panel(html(ui), 'codex-official'), 'data-agent-effort="codex-official"'), ['', 'low', 'medium', 'high', 'xhigh']);
});

test('B0020-hotfix2 a guessed model id that is not in the account list is kept but flagged', async () => {
  const card = panel(html(await boot({ getAgentSettings: withOfficial({ model: 'chatgpt-sol-6', modelSource: 'settings' }) })), 'codex-official');
  assert.match(card, /<option value="__custom__" selected>/);
  assert.match(card, /value="chatgpt-sol-6"/);
  assert.match(card, /not in the Codex model list of this account/);
});

test('B0020-hotfix2 Ollama offers only the thinking values the chosen model accepts', async () => {
  const withOllama = (model, thinking) => ({ ...VIEW, ollamaThinking: { [model]: thinking }, agents: VIEW.agents.map((a) => (a.id === 'ollama' ? { ...a, model, modelSource: 'settings', effort: 'high' } : a)) });
  const noThink = panel(html(await boot({ getAgentSettings: withOllama('qwen3-coder:30b', []) })), 'ollama');
  assert.match(noThink, /This model cannot think\./);
  assert.doesNotMatch(noThink, /data-agent-effort="ollama"/);
  const card = panel(html(await boot({ getAgentSettings: withOllama('qwen3:14b', ['true']) })), 'ollama');
  assert.deepEqual(options(card, 'data-agent-effort="ollama"'), ['', 'true']);
  assert.match(card, /<option value="true">On<\/option>/);
});
