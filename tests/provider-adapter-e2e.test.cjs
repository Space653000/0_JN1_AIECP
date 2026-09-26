'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { ProviderRouter } = require('../electron/lib/provider-router.cjs');
const { git, makeBase, removeDir, makeRepo, waitFor, makeRouter, reviewJson, reviewIds } = require('./support/e2e-fixtures.cjs');

const API_KEY = 'test-secret-key-ABCDEF123456';
const OBJECTIVE = 'Create adapter-output.txt';
const FAKE_PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const ADAPTER_PROVIDERS = { planner: 'company-api', builder: 'local-worker', reviewer: 'company-reviewer' };

// A minimal OpenAI-compatible endpoint that answers planner and reviewer prompts.
async function startEndpoint() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
      const payload = JSON.parse(body);
      const prompt = payload.messages[0].content;
      const kind = /^You are the AECP (Mission )?Planner/.test(prompt) ? 'planner' : 'reviewer';
      requests.push({ url: req.url, kind, authorization: req.headers.authorization, prompt, model: payload.model });
      let content;
      if (prompt.startsWith('You are the AECP Mission Planner')) {
        content = JSON.stringify({ tasks: [{ title: 'Adapter task', objective: OBJECTIVE, acceptance: 'File exists.', dependencies: [], risk: 'GREEN' }] });
      } else if (prompt.startsWith('You are the AECP Planner')) {
        content = JSON.stringify({ tasks: [{ task_id: 'T1', title: 'Adapter task', objective: prompt.match(/OBJECTIVE: ([^\n]+)/)?.[1] || OBJECTIVE, acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] });
      } else {
        content = reviewJson(reviewIds(prompt));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 12, completion_tokens: 7 } }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { requests, port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

async function makeAdapterRouter(base, port) {
  const script = path.join(base, 'local-worker.cjs');
  await fs.writeFile(script, "require('node:fs').writeFileSync('adapter-output.txt', 'made by the registered local worker\\n');\n");
  return new ProviderRouter({
    'company-api': { mode: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'company-model', roles: ['planner', 'reviewer'], apiKey: API_KEY, network: true, credential: true },
    'company-reviewer': { mode: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'company-model', roles: ['reviewer'], network: true },
    'local-worker': { mode: 'local-command', command: 'node', args: [script], roles: ['builder'] }
  });
}

// heartbeatAt is written only when a scheduler heartbeat lands while a task is RUNNING, so a fast task may never get one:
// it is timing-dependent, not part of the schema, and must not make two otherwise identical schemas differ.
const shapeOf = (value) => {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter((key) => key !== 'heartbeatAt').sort().map((key) => [key, shapeOf(value[key])]));
  return 'value';
};

async function runMission(cp, workspace, providers, extra = {}) {
  const run = await cp.createMission({
    goal: 'Attach an external provider', done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 1, maxIterations: 2, maxTurns: 30,
    providers, ...extra
  });
  return run;
}

async function allFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '.git' && entry.name !== 'node_modules') out.push(...await allFiles(full)); } else out.push(full);
  }
  return out;
}

test('B20-27-18 an OpenAI-compatible planner, a keyless OpenAI-compatible reviewer and a registered local worker run a real mission with the same Task schema as any other provider', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());
  const base = await makeBase('aecp-adapter-');
  t.after(async () => removeDir(base));

  const adapterWorkspace = await makeRepo(path.join(base, 'adapter-workspace'));
  const adapterHead = await git(adapterWorkspace, 'rev-parse', 'HEAD');
  const adapterCp = new ControlPlane({ rootDir: path.join(base, 'adapter-runtime'), providerRouter: await makeAdapterRouter(base, endpoint.port) });
  await adapterCp.init();
  adapterCp.lastMaintenanceAt = Date.now();
  t.after(async () => adapterCp.shutdown().catch(() => {}));
  const adapterRun = await runMission(adapterCp, adapterWorkspace, ADAPTER_PROVIDERS, { providerApprovals: { network: true, credential: true } });
  await waitFor(() => adapterRun.state === 'DONE', { timeoutMs: 60000, label: 'the adapter mission to finish' });

  const baselineWorkspace = await makeRepo(path.join(base, 'baseline-workspace'));
  const baselineCp = new ControlPlane({
    rootDir: path.join(base, 'baseline-runtime'),
    providerRouter: makeRouter({ missionTasks: [{ title: 'Adapter task', objective: OBJECTIVE, acceptance: 'File exists.', dependencies: [], risk: 'GREEN' }], onBuilder: async (cwd) => fs.writeFile(path.join(cwd, 'adapter-output.txt'), 'made by the fake worker\n') })
  });
  await baselineCp.init();
  baselineCp.lastMaintenanceAt = Date.now();
  t.after(async () => baselineCp.shutdown().catch(() => {}));
  const baselineRun = await runMission(baselineCp, baselineWorkspace, FAKE_PROVIDERS);
  await waitFor(() => baselineRun.state === 'DONE', { timeoutMs: 60000, label: 'the baseline mission to finish' });

  const adapterTask = adapterCp.state.tasks[adapterRun.taskIds[0]];
  const baselineTask = baselineCp.state.tasks[baselineRun.taskIds[0]];
  assert.equal(adapterTask.state, 'DONE');
  assert.equal(adapterTask.error || null, null);
  assert.deepEqual(shapeOf(adapterTask), shapeOf(baselineTask), 'the persisted Task schema is identical for external adapters');
  assert.deepEqual(shapeOf(adapterRun), shapeOf(baselineRun), 'the persisted Mission schema is identical for external adapters');
  assert.equal(adapterTask.result.tasks[0].worker.provider, 'local-worker');
  assert.ok(adapterTask.result.patch.changedFiles.includes('adapter-output.txt'), 'the registered local worker really produced the change');

  const chat = endpoint.requests.filter((request) => request.url === '/v1/chat/completions');
  assert.ok(chat.length >= 3, 'mission planner, task planner and reviewer all went through the OpenAI-compatible adapter');
  assert.ok(chat.filter((request) => request.kind === 'planner').every((request) => request.authorization === `Bearer ${API_KEY}`), 'the credentialed planner adapter authenticates');
  assert.ok(chat.filter((request) => request.kind === 'reviewer').length >= 1 && chat.filter((request) => request.kind === 'reviewer').every((request) => request.authorization === undefined), 'the keyless reviewer adapter sends no credential');
  assert.ok(chat.every((request) => request.model === 'company-model'));
  assert.equal(await git(adapterWorkspace, 'status', '--porcelain'), '');
  assert.equal(await git(adapterWorkspace, 'rev-parse', 'HEAD'), adapterHead);

  for (const file of await allFiles(path.join(base, 'adapter-runtime'))) {
    if (/\.tmp-\d+-\d+$/.test(file)) continue; // atomic-write scratch files are renamed away while the tree is being read
    const content = await fs.readFile(file, 'latin1').catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
    if (content === null) continue;
    assert.equal(content.includes(API_KEY), false, `${path.relative(base, file)} must not contain the provider credential`);
  }
});

test('B20-27-18 an external provider cannot be used before the human approves network and credential use', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());
  const base = await makeBase('aecp-adapter-gate-');
  t.after(async () => removeDir(base));
  const workspace = await makeRepo(path.join(base, 'workspace'));
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: await makeAdapterRouter(base, endpoint.port) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));

  const run = await runMission(cp, workspace, ADAPTER_PROVIDERS);
  assert.equal(run.state, 'HUMAN_REQUIRED');
  assert.equal(run.waitingFor, 'NETWORK');
  assert.equal(endpoint.requests.length, 0, 'no request may reach the external endpoint before approval');
  assert.equal(run.taskIds.length, 0);
});

test('B20-27-18 a credentialed OpenAI-compatible provider also serves as reviewer once the human approved credential use', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());
  const base = await makeBase('aecp-adapter-keyed-');
  t.after(async () => removeDir(base));
  const keyed = { planner: 'company-api', builder: 'local-worker', reviewer: 'company-api' };
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: await makeAdapterRouter(base, endpoint.port) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));

  const withheld = await makeRepo(path.join(base, 'withheld-workspace'));
  const stopped = await runMission(cp, withheld, keyed, { providerApprovals: { network: true } });
  assert.equal(stopped.state, 'HUMAN_REQUIRED');
  assert.equal(stopped.waitingFor, 'CREDENTIAL');
  assert.equal(endpoint.requests.length, 0, 'the credentialed endpoint is not contacted before credential approval');

  const workspace = await makeRepo(path.join(base, 'approved-workspace'));
  const run = await runMission(cp, workspace, keyed, { providerApprovals: { network: true, credential: true } });
  await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: 'the mission with a credentialed reviewer to finish' });

  const reviews = endpoint.requests.filter((request) => request.kind === 'reviewer');
  assert.ok(reviews.length >= 1, 'the reviewer ran through the OpenAI-compatible adapter');
  assert.ok(endpoint.requests.every((request) => request.authorization === `Bearer ${API_KEY}`));
  assert.equal(cp.state.tasks[run.taskIds[0]].state, 'DONE');
  assert.equal(cp.state.tasks[run.taskIds[0]].error || null, null);
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
