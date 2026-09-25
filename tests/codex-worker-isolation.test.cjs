'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { CodexWorkerRuntime, WORKER_IDS, normalizeWireApi } = require('../electron/lib/codex-worker-runtime.cjs');
const { PEGA_PROVIDER_ID, PEGA_WORKER_ID, PEGA_BASE_URL, PEGA_ENV_KEY, makePegaProvider, normalizePegaWireApi } = require('../electron/lib/pega-provider.cjs');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');
const { git, ok, makeBase, makeRepo, removeDir, waitFor, reviewJson, reviewIds } = require('./support/e2e-fixtures.cjs');

const PEGA_KEY = 'pega-secret-key-ABCDEF0123456789';
const OFFICIAL_AUTH = 'official-auth-token-ZZZ987654321';

async function listFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full)); else out.push(full);
  }
  return out;
}

async function prepareBoth(base) {
  const runtime = new CodexWorkerRuntime(path.join(base, 'codex-workers'));
  const official = await runtime.prepareOfficial({ model: 'official-model' });
  await fs.writeFile(path.join(official.codexHome, 'auth.json'), JSON.stringify({ token: OFFICIAL_AUTH }));
  const pega = await runtime.prepareCustom({ workerId: PEGA_WORKER_ID, workerName: 'Codex PEGA', providerId: PEGA_PROVIDER_ID, providerName: 'PEGA', baseUrl: PEGA_BASE_URL, model: 'pega-model', wireApi: 'responses', envKey: PEGA_ENV_KEY, apiKey: PEGA_KEY });
  return { runtime, official, pega };
}

test('B03-L56 the OFFICIAL and PEGA workers get disjoint CODEX_HOME, runtime, auth and configuration files', async (t) => {
  const base = await makeBase('aecp-worker-iso-');
  t.after(async () => removeDir(base));
  const { runtime, official, pega } = await prepareBoth(base);

  assert.notEqual(official.codexHome, pega.codexHome);
  assert.notEqual(official.runtimeDir, pega.runtimeDir);
  const within = (parent, child) => path.resolve(child).toLowerCase().startsWith(path.resolve(parent).toLowerCase() + path.sep);
  for (const [a, b] of [[official, pega], [pega, official]]) {
    for (const own of [a.codexHome, a.runtimeDir]) for (const other of [b.codexHome, b.runtimeDir]) assert.ok(!within(other, own) && !within(own, other) && path.resolve(own) !== path.resolve(other), `${own} and ${other} must not overlap`);
  }
  assert.equal(official.env.CODEX_HOME, official.codexHome);
  assert.equal(pega.env.CODEX_HOME, pega.codexHome);
  assert.deepEqual(Object.keys(official.env), ['CODEX_HOME'], 'the OFFICIAL worker environment carries no credentials of its own');
  assert.equal(pega.env[PEGA_ENV_KEY], PEGA_KEY);
  assert.equal(JSON.stringify(official.env).includes(PEGA_KEY), false);

  const officialFiles = await listFiles(official.codexHome);
  const pegaFiles = await listFiles(pega.codexHome);
  assert.ok(officialFiles.some((file) => file.endsWith('auth.json')));
  assert.equal(pegaFiles.some((file) => /auth\.json|credentials\.json/.test(file)), false, 'the PEGA home holds no auth file');
  assert.deepEqual((await runtime.inspect(WORKER_IDS.OFFICIAL)).authPresent, true);
  assert.deepEqual((await runtime.inspect(PEGA_WORKER_ID)).authPresent, false);
  for (const file of pegaFiles) {
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes(PEGA_KEY), false, 'the PEGA key is never written to disk');
    assert.equal(text.includes(OFFICIAL_AUTH) || text.includes(official.codexHome), false, 'nothing of the OFFICIAL home leaks into the PEGA home');
  }
  for (const file of officialFiles) {
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes(PEGA_KEY) || text.includes(pega.codexHome), false, 'nothing of PEGA leaks into the OFFICIAL home');
  }
  assert.match(await fs.readFile(path.join(pega.codexHome, 'config.toml'), 'utf8'), new RegExp(`env_key = "${PEGA_ENV_KEY}"`));
});

test('B03-L56 the Worker Registry refuses a second worker on the same CODEX_HOME, however the path is spelled', async (t) => {
  const base = await makeBase('aecp-worker-reg-');
  t.after(async () => removeDir(base));
  const registry = new WorkerRegistry(path.join(base, 'registry'));
  await registry.init();
  const home = path.join(base, 'home-a');
  await fs.mkdir(home);
  const worker = (id, codexHome) => ({ id, name: id, providerId: `provider-${id}`, runtime: 'codex-cli', role: 'builder', codexHome });
  await registry.register(worker('worker-a', home));
  for (const [label, spelled] of [['identical', home], ['different case', home.toUpperCase()], ['dot-dot segment', path.join(home, '..', 'home-a')], ['trailing separator', home + path.sep]]) {
    await assert.rejects(registry.register(worker(`worker-${label.replace(/\W/g, '')}`, spelled)), /must not share CODEX_HOME/, label);
  }
  await registry.register(worker('worker-b', path.join(base, 'home-b')));
  assert.notEqual(registry.get('worker-a').codexHome, registry.get('worker-b').codexHome);
});

test('B03-L56 in a real mission the two workers run with their own CODEX_HOME, their own credentials and their own worktrees', async (t) => {
  const base = await makeBase('aecp-worker-e2e-');
  t.after(async () => removeDir(base));
  const workspace = path.join(base, 'workspace');
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const { runtime, official, pega } = await prepareBoth(base);
  const inspection = await runtime.inspect(WORKER_IDS.OFFICIAL);

  const registry = {
    ...PROVIDERS,
    'openai-official': { id: 'openai-official', command: 'codex', roles: ['builder'], mode: 'codex-cli', network: true, credential: false, requiresCredential: false, requiresAuthFiles: true, authPresent: inspection.authPresent, workerId: WORKER_IDS.OFFICIAL, workerName: 'Codex OFFICIAL', providerName: 'OpenAI Official', defaultModel: 'official-model', codexHome: official.codexHome, runtimeEnv: { ...official.env }, kind: 'codex-worker' },
    [PEGA_PROVIDER_ID]: makePegaProvider({ model: 'pega-model', wireApi: 'responses', apiKey: PEGA_KEY, codexHome: pega.codexHome, runtimeEnv: { ...pega.env } })
  };
  const invocations = [];
  const runner = async (command, args, opts = {}) => {
    const name = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    if (args.includes('--version')) return ok(`${name} 1.0.0`);
    const prompt = args.find((arg) => typeof arg === 'string' && arg.startsWith('You are the AECP')) || '';
    const wrap = (text) => ok(name === 'claude' ? JSON.stringify({ type: 'result', result: text }) : text);
    if (prompt.startsWith('You are the AECP Mission Planner')) {
      return wrap(JSON.stringify({ tasks: [
        { title: 'Task A', objective: 'Change A', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoA] },
        { title: 'Task B', objective: 'Change B', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoB] }
      ] }));
    }
    if (prompt.startsWith('You are the AECP Planner')) return wrap(JSON.stringify({ tasks: [{ task_id: 'T1', title: 'Change', objective: 'Change it', acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] }));
    if (prompt.startsWith('You are the AECP Builder')) {
      invocations.push({ command: name, args: [...args], cwd: opts.cwd, env: { ...(opts.env || {}) } });
      await fs.writeFile(path.join(opts.cwd, 'built.txt'), 'work\n');
      return ok('builder done');
    }
    if (prompt.startsWith('You are the AECP Reviewer')) return wrap(reviewJson(reviewIds(prompt)));
    return { code: 1, stdout: '', stderr: 'unexpected', timedOut: false, aborted: false };
  };
  const router = new ProviderRouter(registry, { runner });
  const workers = new WorkerRegistry(path.join(base, 'registry'));
  await workers.init();
  await workers.register({ id: WORKER_IDS.OFFICIAL, name: 'Codex OFFICIAL', providerId: 'openai-official', providerName: 'OpenAI Official', role: 'builder', runtime: 'codex-cli', codexHome: official.codexHome });
  await workers.register({ id: PEGA_WORKER_ID, name: 'Codex PEGA', providerId: PEGA_PROVIDER_ID, providerName: 'PEGA', role: 'builder', runtime: 'codex-cli', codexHome: pega.codexHome });

  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router, workerRegistry: workers });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  const run = await cp.createMission({
    goal: 'Two isolated workers', done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, maxFailedAttempts: 6,
    providers: { planner: 'claude', builder: 'codex', reviewer: 'claude' }, builderWorkers: [WORKER_IDS.OFFICIAL, PEGA_WORKER_ID], providerApprovals: { network: true, credential: true }
  });
  await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: 'both workers to finish' });

  const tasks = run.taskIds.map((id) => cp.state.tasks[id]);
  assert.deepEqual(tasks.map((task) => task.workerId).sort(), [PEGA_WORKER_ID, WORKER_IDS.OFFICIAL].sort());
  assert.equal(invocations.length, 2);
  assert.equal(invocations.every((entry) => entry.command === 'codex'), true);
  const homes = { [WORKER_IDS.OFFICIAL]: official.codexHome, [PEGA_WORKER_ID]: pega.codexHome };
  for (const task of tasks) {
    const invocation = invocations.find((entry) => path.resolve(entry.cwd).toLowerCase() === path.resolve(task.result.worktree).toLowerCase());
    assert.ok(invocation, `${task.workerId} ran in its own task worktree`);
    assert.equal(invocation.env.CODEX_HOME, homes[task.workerId], `${task.workerId} runs with its own CODEX_HOME`);
    assert.ok(invocation.args.includes('--ephemeral'), `${task.workerId} keeps no session`);
    const others = Object.entries(homes).filter(([id]) => id !== task.workerId).map(([, home]) => home);
    assert.equal(JSON.stringify(invocation.env).includes(others[0]), false, 'the other worker home never appears in this worker environment');
    assert.equal(invocation.args.join(' ').includes(PEGA_KEY) || invocation.args.join(' ').includes(OFFICIAL_AUTH), false, 'no credential is passed on the command line');
    if (task.workerId === PEGA_WORKER_ID) assert.equal(invocation.env[PEGA_ENV_KEY], PEGA_KEY);
    else assert.equal(PEGA_ENV_KEY in invocation.env || JSON.stringify(invocation.env).includes(PEGA_KEY), false, 'the OFFICIAL worker never receives the PEGA key');
  }
  assert.notEqual(workers.get(WORKER_IDS.OFFICIAL).codexHome, workers.get(PEGA_WORKER_ID).codexHome);
  assert.equal(await git(repoA, 'status', '--porcelain'), '');
  assert.equal(await git(repoB, 'status', '--porcelain'), '');
});

test('B03-L68 unsupported wire APIs and unsafe worker endpoints fail closed', async (t) => {
  assert.equal(normalizeWireApi(undefined), 'responses');
  assert.equal(normalizeWireApi(' RESPONSES '), 'responses');
  assert.equal(normalizeWireApi('Chat'), 'chat');
  assert.equal(normalizePegaWireApi('CHAT'), 'chat');
  for (const bad of ['completions', 'chat-completions', 'assistants', 'grpc', 'responses,chat']) {
    assert.throws(() => normalizeWireApi(bad), /must be "responses" or "chat"/);
    assert.throws(() => normalizePegaWireApi(bad), /wire API must be "responses" or "chat"/);
    assert.throws(() => makePegaProvider({ wireApi: bad }));
  }

  const base = await makeBase('aecp-wire-');
  t.after(async () => removeDir(base));
  const runtime = new CodexWorkerRuntime(path.join(base, 'w'));
  const custom = (extra) => runtime.prepareCustom({ workerId: 'custom-worker', providerId: 'custom', providerName: 'Custom', baseUrl: 'https://api.example.com/v1', model: 'm', envKey: 'CUSTOM_API_KEY', ...extra });
  await assert.rejects(custom({ wireApi: 'completions' }), /must be "responses" or "chat"/);
  await assert.rejects(custom({ baseUrl: 'http://api.example.com/v1' }), /HTTPS/);
  await assert.rejects(custom({ baseUrl: 'https://user:secret@api.example.com/v1' }), /embed credentials/);
  await assert.rejects(custom({ model: '' }), /explicit model/);
  await assert.rejects(custom({ envKey: 'lower-case' }), /env key is invalid/);
  const okProfile = await custom({ wireApi: 'chat', baseUrl: 'http://127.0.0.1:9/v1' });
  assert.match(await fs.readFile(path.join(okProfile.codexHome, 'config.toml'), 'utf8'), /wire_api = "chat"/);
  assert.equal(okProfile.wireApi, 'chat');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
