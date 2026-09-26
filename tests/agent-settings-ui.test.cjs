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

test('B0019 saving sends only the model and the effort the tool supports, after the person changed them', async () => {
  const saved = [];
  const ui = await boot({ setAgentSettings: (agentId, patch) => { saved.push([agentId, patch]); return VIEW; } });
  await changeWith(ui, '[data-agent-model]', { agentModel: 'ollama' }, 'llama3.2:3b');
  await changeWith(ui, '[data-agent-effort]', { agentEffort: 'ollama' }, 'medium');
  await clickWith(ui, '[data-agent-save]', { agentSave: 'ollama' });
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [['ollama', { model: 'llama3.2:3b', effort: 'medium' }]]);
  await changeWith(ui, '[data-agent-model]', { agentModel: 'gemini-cli' }, 'gemini-2.5-pro');
  await clickWith(ui, '[data-agent-save]', { agentSave: 'gemini-cli' });
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(saved[1])), ['gemini-cli', { model: 'gemini-2.5-pro' }], 'no effort is sent for a tool without one');
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
  // codex-official has no model in this fixture; B0020-hotfix requires one before Say hi is offered.
  assert.match(panel(source, 'codex-official'), /Choose an OFFICIAL model first\./);
  const withModel = html(await boot({ getAgentSettings: { ...VIEW, agents: VIEW.agents.map((a) => a.id === 'codex-official' ? { ...a, model: 'gpt-5.1-codex', modelSource: 'settings' } : a) } }));
  assert.match(panel(withModel, 'codex-official'), /Connects to the network and uses your account quota/);
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

test('B0020-hotfix Codex OFFICIAL: say-hi is disabled with a clear note until a model is chosen, and enabled once one is', async () => {
  const noModel = await boot({ getAgentSettings: { ...VIEW, agents: VIEW.agents.map((a) => a.id === 'codex-official' ? { ...a, model: null, modelSource: 'default' } : a) } });
  const before = panel(html(noModel), 'codex-official');
  assert.match(before, /data-agent-sayhi="codex-official" disabled/);
  assert.match(before, /Choose an OFFICIAL model first\./);
  await changeWith(noModel, '[data-agent-model]', { agentModel: 'codex-official' }, 'gpt-5.1-codex', 'INPUT');
  const afterPick = panel(html(noModel), 'codex-official');
  assert.doesNotMatch(afterPick, /data-agent-sayhi="codex-official" disabled/, 'picking a model (even before saving) enables the button');
});
