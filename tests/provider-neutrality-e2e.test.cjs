'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');
const { git, ok, makeBase, makeRepo, removeDir, waitFor, makeRouter, reviewJson, reviewIds } = require('./support/e2e-fixtures.cjs');

const API_KEY = 'neutrality-secret-key-0123456789';
const PRIVATE = 'PRIVATE-MARKER-XYZ-7781';
const MISSION_TASKS = [{ title: 'Provider swap task', objective: 'Create the output file', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' }];

const shapeOf = (value) => {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
  return 'value';
};

async function startEndpoint() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
      const prompt = JSON.parse(body).messages[0].content;
      requests.push({ url: req.url, prompt, authorization: req.headers.authorization });
      let content;
      if (prompt.startsWith('You are the AECP Mission Planner')) content = JSON.stringify({ tasks: MISSION_TASKS });
      else if (prompt.startsWith('You are the AECP Planner')) content = JSON.stringify({ tasks: [{ task_id: 'T1', title: 'Provider swap task', objective: 'Create the output file', acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] });
      else content = reviewJson(reviewIds(prompt));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { requests, port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

// Emulates the command line tools at the process boundary; the ProviderRouter above it is the real one.
function makeCliRunner(log, { failFor = new Set() } = {}) {
  return async (command, args, opts = {}) => {
    const base = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    log.push({ base, args: [...args], cwd: opts.cwd, env: opts.env });
    if (base === 'where' || base === 'which') return ok(`C:\\tools\\${args[0]}`);
    if (args.includes('--version')) return ok(`${base} 1.2.3`);
    if (failFor.has(base)) return { code: 1, stdout: '', stderr: `${base} failed`, timedOut: false, aborted: false };
    const prompt = args.find((arg) => typeof arg === 'string' && arg.startsWith('You are the AECP')) || '';
    const wrap = (text) => ok(base === 'claude' ? JSON.stringify({ type: 'result', result: text }) : text);
    if (prompt.startsWith('You are the AECP Mission Planner')) return wrap(JSON.stringify({ tasks: MISSION_TASKS }));
    if (prompt.startsWith('You are the AECP Planner')) return wrap(JSON.stringify({ tasks: [{ task_id: 'T1', title: 'Provider swap task', objective: 'Create the output file', acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] }));
    if (prompt.startsWith('You are the AECP Builder')) { await fs.writeFile(path.join(opts.cwd, `built-by-${base}.txt`), 'work\n'); return ok('builder done'); }
    if (prompt.startsWith('You are the AECP Reviewer')) return wrap(reviewJson(reviewIds(prompt)));
    return { code: 1, stdout: '', stderr: `unexpected invocation of ${base}`, timedOut: false, aborted: false };
  };
}

async function bootStack(t, { endpoint = null, failFor = new Set() } = {}) {
  const base = await makeBase('aecp-neutral-');
  t.after(async () => removeDir(base));
  const workspace = await makeRepo(path.join(base, 'workspace'));
  const head = await git(workspace, 'rev-parse', 'HEAD');
  const log = [];
  const registry = {
    ...PROVIDERS,
    'local-worker': { mode: 'local-command', command: 'node', args: ['worker.cjs'], roles: ['planner', 'builder', 'reviewer'] },
    ...(endpoint ? { 'company-api': { mode: 'openai-compatible', baseUrl: `http://127.0.0.1:${endpoint.port}/v1`, defaultModel: 'company-model', roles: ['planner', 'reviewer'], apiKey: API_KEY, network: true, credential: true } } : {})
  };
  const router = new ProviderRouter(registry, { runner: makeCliRunner(log, { failFor }) });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  return { base, workspace, head, log, router, cp };
}

const startMission = (fx, providers, extra = {}) => fx.cp.createMission({
  goal: `Swap providers without changing state. ${PRIVATE}`, done: 'Verification passes.', sourceRoot: fx.workspace, autoStart: true, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, maxFailedAttempts: 6, providers, ...extra
});

const SETS = [
  { name: 'cli cloud tools', providers: { planner: 'claude', builder: 'codex', reviewer: 'gemini' }, approvals: { network: true }, bins: ['claude', 'codex', 'gemini'] },
  { name: 'cli mixed tools', providers: { planner: 'opencode', builder: 'opencode', reviewer: 'claude' }, approvals: { network: true }, bins: ['opencode', 'claude'] },
  { name: 'local models and a local command', providers: { planner: 'ollama', builder: 'local-worker', reviewer: 'ollama' }, models: { planner: 'llama3', reviewer: 'llama3' }, approvals: {}, bins: ['ollama', 'node'] },
  { name: 'openai-compatible endpoint and a local command', providers: { planner: 'company-api', builder: 'local-worker', reviewer: 'company-api' }, approvals: { network: true, credential: true }, http: true, bins: ['node'] }
];

test('B03-L5 the Harness state is identical whichever kind of provider produced the work (CLI tools, local models, local command, OpenAI-compatible endpoint)', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());
  const shapes = [];
  for (const set of SETS) {
    const fx = await bootStack(t, { endpoint });
    const run = await startMission(fx, set.providers, { models: set.models, providerApprovals: set.approvals });
    await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: `${set.name} to finish` });
    const task = fx.cp.state.tasks[run.taskIds[0]];
    assert.equal(task.state, 'DONE', `${set.name}: ${task.error || ''}`);
    assert.equal(task.error || null, null);
    const used = new Set(fx.log.filter((entry) => !['where', 'which'].includes(entry.base)).map((entry) => entry.base));
    for (const bin of set.bins) assert.ok(used.has(bin), `${set.name}: ${bin} was really invoked (saw ${[...used]})`);
    assert.ok(task.result.patch.changedFiles.length >= 0);
    assert.deepEqual(run.providers, set.providers, 'the provider identity is recorded as data');
    shapes.push({ name: set.name, task: shapeOf(task), run: shapeOf(run), harness: shapeOf(task.result), patch: shapeOf(task.result.patch) });
    assert.equal(await git(fx.workspace, 'status', '--porcelain'), '');
    assert.equal(await git(fx.workspace, 'rev-parse', 'HEAD'), fx.head);
  }
  for (const shape of shapes.slice(1)) {
    assert.deepEqual(shape.task, shapes[0].task, `${shape.name}: Task schema`);
    assert.deepEqual(shape.run, shapes[0].run, `${shape.name}: Mission schema`);
    assert.deepEqual(shape.harness, shapes[0].harness, `${shape.name}: Harness record schema`);
    assert.deepEqual(shape.patch, shapes[0].patch, `${shape.name}: patch schema`);
  }
  assert.ok(endpoint.requests.length >= 3, 'the OpenAI-compatible set really went through the endpoint');
});

test('B03-L70 worker names never change Mission/Task/Queue/Harness behaviour: OFFICIAL/PEGA worker ids and neutral ids give the same state', async (t) => {
  const outcomes = [];
  for (const ids of [['codex-official', 'codex-pega'], ['alpha-worker', 'beta-worker']]) {
    const base = await makeBase('aecp-workers-');
    t.after(async () => removeDir(base));
    const workspace = path.join(base, 'workspace');
    const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
    const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
    const workers = new WorkerRegistry(path.join(base, 'workers'));
    await workers.init();
    for (const id of ids) await workers.register({ id, name: id, providerId: `provider-${id}`, providerName: id, runtime: 'codex-cli', role: 'builder', codexHome: path.join(base, `home-${id}`) });
    const calls = [];
    const inner = makeRouter({
      calls,
      missionTasks: [
        { title: 'Change A', objective: 'Change repo A', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoA] },
        { title: 'Change B', objective: 'Change repo B', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoB] }
      ]
    });
    const router = { ...inner, resolve: (role, provider) => (role === 'builder' && provider.startsWith('provider-') ? { id: provider } : inner.resolve(role, provider)) };
    const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router, workerRegistry: workers });
    await cp.init();
    cp.lastMaintenanceAt = Date.now();
    t.after(async () => cp.shutdown().catch(() => {}));
    const run = await cp.createMission({ goal: 'Two workers, two repositories', done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, providers: { planner: 'plan', builder: 'build', reviewer: 'review' }, builderWorkers: ids });
    await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: 'both workers to finish' });
    const tasks = run.taskIds.map((id) => cp.state.tasks[id]);
    await waitFor(async () => ids.every((id) => workers.get(id).runtimeState === 'IDLE') && (await cp.listEvents(2000)).some((event) => event.type === 'mission.finished'), { timeoutMs: 60000, label: 'the Workers to be released and the mission.finished journal entry' });
    assert.deepEqual(tasks.map((task) => task.state), ['DONE', 'DONE']);
    assert.deepEqual(tasks.map((task) => task.workerId).sort(), [...ids].sort(), 'each task ran on a different worker');
    outcomes.push({ task: shapeOf(tasks[0]), run: shapeOf(run), events: [...new Set((await cp.listEvents(2000)).map((event) => event.type))].sort(), registry: shapeOf(workers.get(ids[0])), states: ids.map((id) => workers.get(id).runtimeState) });
  }
  assert.deepEqual(outcomes[1], outcomes[0], 'the persisted state and the event vocabulary do not depend on the worker names');

  const libDir = path.join(__dirname, '..', 'electron', 'lib');
  const stateMachine = ['control-plane', 'harness', 'execution-contract', 'worker-registry', 'event-projection', 'failure-recovery', 'guidance', 'protocol'];
  for (const name of stateMachine) assert.doesNotMatch(await fs.readFile(path.join(libDir, `${name}.cjs`), 'utf8'), /pega/i, `${name}.cjs must contain no PEGA-specific logic`);
});

test('B03-L143 a local provider is never silently replaced by a cloud provider: failures stop, private context stays local, cloud use needs an explicit choice and approval', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());

  const local = await bootStack(t, { endpoint });
  const localProviders = { planner: 'ollama', builder: 'local-worker', reviewer: 'ollama' };
  const success = await startMission(local, localProviders, { models: { planner: 'llama3', reviewer: 'llama3' } });
  await waitFor(() => success.state === 'DONE', { timeoutMs: 60000, label: 'the local mission' });
  assert.equal(endpoint.requests.length, 0, 'a mission on local providers never reaches the registered cloud endpoint');
  assert.ok(local.log.some((entry) => entry.args.some((arg) => typeof arg === 'string' && arg.includes(PRIVATE))), 'the private context was used by the local providers');
  assert.deepEqual([...new Set(local.log.map((entry) => entry.base))].filter((name) => !['where', 'which'].includes(name)).sort(), ['node', 'ollama']);

  const failing = await bootStack(t, { endpoint, failFor: new Set(['ollama']) });
  const failure = await startMission(failing, localProviders, { models: { planner: 'llama3', reviewer: 'llama3' } }).then((run) => ({ run }), (error) => ({ error }));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.ok(failure.error, 'the mission stops when its local planner fails');
  assert.match(failure.error.message, /Mission planner failed/);
  assert.equal(endpoint.requests.length, 0, 'no automatic failover to the cloud provider');
  assert.deepEqual([...new Set(failing.log.map((entry) => entry.base))].filter((name) => !['where', 'which'].includes(name)), ['ollama'], 'no other provider was tried');

  const unapproved = await bootStack(t, { endpoint });
  const gated = await startMission(unapproved, { planner: 'company-api', builder: 'local-worker', reviewer: 'company-api' });
  assert.equal(gated.state, 'HUMAN_REQUIRED');
  assert.equal(gated.waitingFor, 'NETWORK');
  assert.equal(endpoint.requests.length, 0, 'choosing a cloud provider does nothing until the human approves');

  const approved = await bootStack(t, { endpoint });
  const crossing = await startMission(approved, { planner: 'company-api', builder: 'local-worker', reviewer: 'company-api' }, { providerApprovals: { network: true, credential: true } });
  await waitFor(() => crossing.state === 'DONE', { timeoutMs: 60000, label: 'the approved cloud mission' });
  assert.ok(endpoint.requests.some((request) => request.prompt.includes(PRIVATE)), 'context only crosses the boundary through an explicit, approved choice');

  const router = local.router;
  assert.equal(router.resolve('planner', 'codex'), null, 'a provider that cannot serve the role is not replaced by another one');
  const before = local.log.length;
  await assert.rejects(router.execute('planner', 'You are the AECP Planner. secret', { provider: 'codex' }), /No provider for role/);
  assert.equal(local.log.length, before);
  assert.equal(endpoint.requests.filter((request) => request.prompt.includes('secret')).length, 0);
});

test('B03-L172 the Harness makes exactly the model calls the work needs and none to keep agents busy', async (t) => {
  const calls = [];
  const base = await makeBase('aecp-idle-');
  t.after(async () => removeDir(base));
  const repo = await makeRepo(path.join(base, 'workspace'));
  const router = makeRouter({
    calls,
    missionTasks: [
      { title: 'First', objective: 'Do first', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' },
      { title: 'Second', objective: 'Do second', acceptance: 'Verification passes.', dependencies: ['First'], risk: 'GREEN' }
    ],
    onBuilder: async (cwd, entry) => fs.writeFile(path.join(cwd, `${entry.title}.txt`), 'x')
  });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  const kinds = () => calls.map((call) => call.kind).join(',');

  const run = await cp.createMission({ goal: 'Two dependent tasks', done: 'Verification passes.', sourceRoot: repo, autoStart: true, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, providers: { planner: 'plan', builder: 'build', reviewer: 'review' } });
  await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: 'the mission' });
  const expected = 'mission-planner,planner,builder,reviewer,planner,builder,reviewer';
  assert.equal(kinds(), expected, 'one planning call for the mission, then planner, builder and reviewer once per task');
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.equal(kinds(), expected, 'a finished mission makes no further model calls');
});

test('B03-L172 waiting for a dependency, waiting for a human and exhausting the iteration budget make no extra model calls', async (t) => {
  const base = await makeBase('aecp-idle2-');
  t.after(async () => removeDir(base));
  const repo = await makeRepo(path.join(base, 'workspace'));

  const hangCalls = [];
  const hangRouter = makeRouter({
    calls: hangCalls,
    onBuilder: async (_cwd, entry) => {
      await new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (entry.opts.signal.aborted) abort(); else entry.opts.signal.addEventListener('abort', abort, { once: true });
      });
    }
  });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: hangRouter });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  const run = await cp.createMission({ goal: 'Blocked chain', done: 'Verification passes.', sourceRoot: repo, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, providers: { planner: 'plan', builder: 'build', reviewer: 'review' } });
  const first = await cp.enqueueTask(run, { title: 'Hangs', objective: 'Never finishes', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });
  await cp.enqueueTask(run, { title: 'Waits', objective: 'Waits for the first', acceptance: 'Verification passes.', dependencies: [first.id], risk: 'GREEN' });
  await cp.schedulerTick();
  await waitFor(() => hangCalls.some((call) => call.role === 'builder'), { label: 'the first builder to start' });
  const snapshot = hangCalls.map((call) => call.kind).join(',');
  assert.equal(snapshot, 'planner,builder');
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(hangCalls.map((call) => call.kind).join(','), snapshot, 'the dependent task and the idle scheduler made no model calls');

  const gateCalls = [];
  const gateBase = await makeBase('aecp-idle3-');
  t.after(async () => removeDir(gateBase));
  const gateRepo = await makeRepo(path.join(gateBase, 'workspace'));
  const gateCp = new ControlPlane({ rootDir: path.join(gateBase, 'runtime'), providerRouter: makeRouter({ calls: gateCalls, onReviewer: async () => ({ result: 'HUMAN_REQUIRED' }) }) });
  await gateCp.init();
  gateCp.lastMaintenanceAt = Date.now();
  t.after(async () => gateCp.shutdown().catch(() => {}));
  const gated = await gateCp.createMission({ goal: 'Needs a human', done: 'Verification passes.', sourceRoot: gateRepo, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, providers: { planner: 'plan', builder: 'build', reviewer: 'review' } });
  const gatedTask = await gateCp.enqueueTask(gated, { title: 'Gate', objective: 'Ask a human', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });
  await gateCp.schedulerTick();
  await waitFor(() => gatedTask.state === 'HUMAN_REQUIRED' && gated.state === 'HUMAN_REQUIRED', { label: 'the human gate' });
  const gateSnapshot = gateCalls.map((call) => call.kind).join(',');
  assert.equal(gateSnapshot, 'planner,builder,reviewer');
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(gateCalls.map((call) => call.kind).join(','), gateSnapshot, 'a mission waiting for a human makes no model calls');

  const failCalls = [];
  const failBase = await makeBase('aecp-idle4-');
  t.after(async () => removeDir(failBase));
  const failRepo = await makeRepo(path.join(failBase, 'workspace'));
  const failing = makeRouter({ calls: failCalls });
  const realExecute = failing.execute;
  failing.execute = async (role, prompt, opts) => (role === 'builder' ? (failCalls.push({ role, kind: 'builder' }), { code: 1, stdout: '', stderr: 'builder crashed', timedOut: false, aborted: false }) : realExecute(role, prompt, opts));
  const failCp = new ControlPlane({ rootDir: path.join(failBase, 'runtime'), providerRouter: failing });
  await failCp.init();
  failCp.lastMaintenanceAt = Date.now();
  t.after(async () => failCp.shutdown().catch(() => {}));
  const failRun = await failCp.createMission({ goal: 'Builder always fails', done: 'Verification passes.', sourceRoot: failRepo, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, maxFailedAttempts: 6, providers: { planner: 'plan', builder: 'build', reviewer: 'review' } });
  const failTask = await failCp.enqueueTask(failRun, { title: 'Fails', objective: 'Cannot succeed', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });
  await failCp.schedulerTick();
  await waitFor(() => failTask.state === 'BLOCKED', { timeoutMs: 60000, label: 'the iteration budget to be exhausted' });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(failCalls.filter((call) => call.role === 'builder').length, 2, 'never more builder calls than the iteration budget');
  assert.equal(failCalls.filter((call) => call.kind === 'reviewer').length, 0, 'no review is invoked for a failed build');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
