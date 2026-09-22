'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ControlPlane, STATES, TERMINAL } = require('../electron/lib/control-plane.cjs');

test('ControlPlane persists state and event journal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-control-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  const run = { id: 'mission-test', state: 'QUEUED', taskIds: [], events: [] };
  cp.state.runs[run.id] = run;
  const task = await cp.enqueueTask(run, { title: 'Test task', objective: 'Test', acceptance: 'PASS', risk: 'GREEN' });
  assert.equal(task.state, 'QUEUED');
  const status = await cp.status();
  assert.equal(status.tasks.length, 1);
  const events = await cp.listEvents();
  assert.ok(events.some(e => e.type === 'task.queued'));
  const cp2 = new ControlPlane({ rootDir: root });
  await cp2.init();
  assert.equal((await cp2.status()).tasks.length, 1);
  await cp.shutdown();
  await cp2.shutdown();
  await fs.rm(root, { recursive: true, force: true });
});

test('ControlPlane serializes concurrent state persistence without stale overwrite', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-persist-race-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  try {
    const writes = [];
    for (let i = 0; i < 20; i += 1) {
      cp.state.persistenceProbe = i;
      writes.push(cp.persist());
    }
    await Promise.all(writes);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'control-plane.json'), 'utf8'));
    assert.equal(saved.persistenceProbe, 19);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ControlPlane exposes bounded lifecycle states', () => {
  assert.ok(STATES.includes('RUNNING'));
  assert.ok(STATES.includes('HUMAN_REQUIRED'));
  assert.ok(TERMINAL.has('DONE'));
  assert.ok(TERMINAL.has('CANCELLED'));
});


test('ControlPlane recovers orphaned execution state after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-recover-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  const run = { id: 'mission-recovery', state: 'RUNNING', taskIds: [], events: [] };
  cp.state.runs[run.id] = run;
  const task = await cp.enqueueTask(run, { title: 'Recover me', objective: 'Recover', acceptance: 'PASS', risk: 'GREEN' });
  task.state = 'RUNNING';
  task.phase = 'EXECUTING';
  task.lease = { id: 'lease', owner: 999999, expiresAt: new Date(Date.now() + 600000).toISOString() };
  await cp.persist();
  await cp.shutdown();
  const cp2 = new ControlPlane({ rootDir: root });
  await cp2.init();
  const recoveredRun = await cp2.getRun(run.id);
  const recovered = await cp2.getTask(task.id);
  assert.equal(recoveredRun.state, 'PAUSED');
  assert.equal(recoveredRun.recovery.reason, 'process-restart');
  assert.equal(recoveredRun.recovery.requiresExplicitResume, true);
  assert.equal(recovered.state, 'QUEUED');
  assert.equal(recovered.phase, 'RECOVERED');
  await cp2.shutdown();
  await fs.rm(root, { recursive: true, force: true });
});

test('ControlPlane stores explicit provider roles and scopes policy to the mission workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-mission-'));
  const workspace = path.join(root, 'workspace');
  const runtime = path.join(root, 'runtime');
  await fs.mkdir(workspace, { recursive: true });
  const cp = new ControlPlane({ rootDir: runtime });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Use explicit provider roles',
      done: 'Mission configuration is persisted',
      sourceRoot: workspace,
      autoStart: false,
      providers: { planner: 'gemini', builder: 'opencode', reviewer: 'gemini' },
      models: { planner: 'planner-model', builder: 'local/model', reviewer: 'review-model' }
    });
    assert.deepEqual(run.providers, { planner: 'gemini', builder: 'opencode', reviewer: 'gemini' });
    assert.equal(run.models.builder, 'local/model');
    const policy = cp.policyForRun(run);
    assert.equal(policy.check({ action: 'EXECUTE', path: workspace }).allowed, true);
    assert.equal(policy.check({ action: 'WRITE', path: path.join(workspace, 'file.txt') }).allowed, true);
    assert.equal(policy.check({ action: 'WRITE', path: path.join(root, 'outside') }).allowed, false);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ControlPlane rejects a provider that cannot serve the requested role', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-invalid-'));
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  try {
    await assert.rejects(() => cp.createMission({
      goal: 'Reject invalid role routing',
      done: 'Invalid role provider is rejected',
      sourceRoot: root,
      autoStart: false,
      providers: { planner: 'codex', builder: 'codex', reviewer: 'claude' }
    }), /cannot serve role "planner"/);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ControlPlane queues a run-level provider approval before any network-backed mission planning', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-approval-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const router = {
    resolve(role, provider) {
      const allowed = { planner: ['cloud-plan'], builder: ['local-build'], reviewer: ['cloud-review'] };
      return allowed[role]?.includes(provider) ? { id: provider } : null;
    },
    capabilities(role, provider) {
      if (provider === 'cloud-plan' || provider === 'cloud-review') return { process: true, network: true, credential: false };
      if (provider === 'local-build') return { process: true, network: false, credential: false };
      return null;
    },
    async execute() { throw new Error('Provider execution must not occur before approval.'); }
  };
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: router });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Require governed provider access',
      done: 'No provider executes before approval',
      sourceRoot: workspace,
      autoStart: true,
      providers: { planner: 'cloud-plan', builder: 'local-build', reviewer: 'cloud-review' }
    });
    assert.equal(run.state, 'HUMAN_REQUIRED');
    assert.equal(run.waitingFor, 'NETWORK');
    assert.equal(run.taskIds.length, 0);
    const waiting = Object.values(cp.state.approvals).filter((a) => a.runId === run.id && a.state === 'WAITING');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].action, 'NETWORK');
    assert.equal(waiting[0].taskId, null);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejecting a run-level provider approval blocks the mission without provider execution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-reject-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const router = {
    resolve(role, provider) {
      const allowed = { planner: ['cloud-plan'], builder: ['local-build'], reviewer: ['cloud-review'] };
      return allowed[role]?.includes(provider) ? { id: provider } : null;
    },
    capabilities(_role, provider) {
      return provider.startsWith('cloud-')
        ? { process: true, network: true, credential: false }
        : { process: true, network: false, credential: false };
    },
    async execute() { throw new Error('Provider execution must not occur after rejection.'); }
  };
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: router });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Reject model network access',
      done: 'Mission is blocked',
      sourceRoot: workspace,
      autoStart: true,
      providers: { planner: 'cloud-plan', builder: 'local-build', reviewer: 'cloud-review' }
    });
    const approval = Object.values(cp.state.approvals).find((a) => a.runId === run.id && a.state === 'WAITING');
    await cp.reject(approval.id, { by: 'human', note: 'No network for this mission' });
    assert.equal((await cp.getRun(run.id)).state, 'BLOCKED');
    assert.equal((await cp.getRun(run.id)).blockReason, 'No network for this mission');
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ControlPlane makes remote approval decisions idempotent by request id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-remote-approval-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  try {
    cp.state.runs.r1 = { id: 'r1', state: 'HUMAN_REQUIRED', taskIds: ['t1'], events: [] };
    cp.state.tasks.t1 = { id: 't1', runId: 'r1', state: 'HUMAN_REQUIRED', lease: null };
    cp.state.approvals.a1 = { id: 'a1', runId: 'r1', taskId: 't1', state: 'WAITING', risk: 'RED', reason: 'Approve existing task action', action: 'SYSTEM', createdAt: new Date().toISOString() };
    await cp.persist();

    const first = await cp.approve('a1', { by: 'remote:phone', note: 'Approve', idempotencyKey: 'approve-a1-001' });
    const replay = await cp.approve('a1', { by: 'remote:phone', note: 'Approve', idempotencyKey: 'approve-a1-001' });
    assert.equal(first.state, 'APPROVED');
    assert.equal(replay.state, 'APPROVED');
    assert.equal(replay.decisionIdempotencyKey, 'approve-a1-001');

    await assert.rejects(
      () => cp.approve('a1', { by: 'remote:other', note: 'Different replay', idempotencyKey: 'approve-a1-002' }),
      /Approval is not waiting/
    );
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('restart recovery never auto-resumes a mutating mission even when autoResume was enabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-no-blind-replay-'));
  try {
    const cp = new ControlPlane({ rootDir: root });
    await cp.init();
    const run = {
      id:'mission-no-blind-replay',
      schema:'aecp.mission/v1',
      state:'RUNNING',
      autoResume:true,
      taskIds:[],
      events:[],
      sourceRoot:root,
      maxConcurrency:1
    };
    cp.state.runs[run.id]=run;
    const task=await cp.enqueueTask(run,{title:'Mutating task',objective:'Do not replay blindly',acceptance:'PASS',risk:'YELLOW'});
    task.state='RUNNING';
    task.phase='EXECUTING';
    task.lease={id:'lease',owner:999999,expiresAt:new Date(Date.now()+600000).toISOString()};
    await cp.persist();
    await cp.shutdown();

    const cp2=new ControlPlane({rootDir:root});
    await cp2.init();
    const recoveredRun=await cp2.getRun(run.id);
    const recoveredTask=await cp2.getTask(task.id);
    assert.equal(recoveredRun.state,'PAUSED');
    assert.equal(recoveredRun.recovery.requiresExplicitResume,true);
    assert.equal(recoveredTask.state,'QUEUED');
    assert.equal(recoveredTask.resume,true);
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await cp2.getRun(run.id)).state,'PAUSED');
    assert.equal((await cp2.getTask(task.id)).state,'QUEUED');
    await cp2.shutdown();
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});


test('budget exhaustion is terminal across Control Plane and Dashboard', async () => {
  const { STATES, TERMINAL } = require('../electron/lib/control-plane.cjs');
  const fsSync = require('node:fs');
  const dashboard = fsSync.readFileSync(require('node:path').join(__dirname, '..', 'ui', 'harness-console.js'), 'utf8');
  assert.ok(STATES.includes('BUDGET_EXHAUSTED'));
  assert.ok(TERMINAL.has('BUDGET_EXHAUSTED'));
  assert.match(dashboard,/BUDGET_EXHAUSTED/);
});


test('ControlPlane persists explicit mission hard budgets for Harness execution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-mission-budgets-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Persist bounded mission controls',
      done: 'Every hard budget is durable',
      sourceRoot: workspace,
      autoStart: false,
      maxTasks: 3,
      maxIterations: 4,
      maxTurns: 17,
      maxFailedAttempts: 7,
      maxNoProgressAttempts: 3,
      maxWallClockMs: 600000,
      maxPatchBytes: 2 * 1024 * 1024,
      maxChangedFiles: 25,
      checkpointEvery: 2
    });
    assert.equal(run.maxTasks, 3);
    assert.equal(run.maxIterations, 4);
    assert.equal(run.maxTurns, 17);
    assert.equal(run.maxFailedAttempts, 7);
    assert.equal(run.maxNoProgressAttempts, 3);
    assert.equal(run.maxWallClockMs, 600000);
    assert.equal(run.maxPatchBytes, 2 * 1024 * 1024);
    assert.equal(run.maxChangedFiles, 25);
    assert.equal(run.checkpointEvery, 2);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'runtime', 'control-plane.json'), 'utf8'));
    assert.equal(saved.runs[run.id].maxTurns, 17);
    assert.equal(saved.runs[run.id].maxChangedFiles, 25);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Command Center exposes finite mission budgets instead of hidden unbounded defaults', async () => {
  const dashboard = await fs.readFile(path.join(__dirname, '..', 'ui', 'harness-console.js'), 'utf8');
  for (const id of ['hcTurns','hcFailures','hcChangedFiles','hcPatchMiB','hcWallMinutes']) {
    assert.match(dashboard, new RegExp(id));
  }
  assert.match(dashboard, /maxTurns:/);
  assert.match(dashboard, /maxFailedAttempts:/);
  assert.match(dashboard, /maxChangedFiles:/);
  assert.match(dashboard, /maxPatchBytes:/);
  assert.match(dashboard, /maxWallClockMs:/);
});


test('ControlPlane hasActiveWork guards local-data mutation only while missions are nonterminal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-active-work-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  try {
    assert.equal(cp.hasActiveWork(), false);
    cp.state.runs.active = { id:'active', state:'RUNNING', taskIds:[], events:[] };
    assert.equal(cp.hasActiveWork(), true);
    cp.state.runs.active.state = 'PAUSED';
    assert.equal(cp.hasActiveWork(), true);
    cp.state.runs.active.state = 'DONE';
    assert.equal(cp.hasActiveWork(), false);
    cp.controllers.set('task-x', new AbortController());
    assert.equal(cp.hasActiveWork(), true);
    cp.controllers.clear();
    assert.equal(cp.hasActiveWork(), false);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('scheduler decision blocks a conflicting repository writer and records explainable reasons', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-scheduler-lock-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  try {
    const run = {
      id:'run-lock',
      state:'RUNNING',
      sourceRoot:workspace,
      taskIds:['task-a','task-b'],
      maxIterations:3,
      providers:{planner:'claude',builder:'codex',reviewer:'claude'},
      models:{planner:null,builder:null,reviewer:null},
      providerApprovals:{network:false,credential:false}
    };
    const task = {
      id:'task-b',
      runId:run.id,
      state:'QUEUED',
      risk:'YELLOW',
      priority:50,
      attempts:0,
      dependencies:[],
      resources:{repositories:[workspace]}
    };
    cp.state.runs[run.id]=run;
    cp.state.tasks['task-a']={id:'task-a',runId:run.id,state:'RUNNING',resources:{repositories:[workspace]}};
    cp.state.tasks['task-b']=task;
    const key='repo:'+path.resolve(workspace).toLowerCase();
    await cp.locks.acquire(key,'task-a',{meta:{runId:run.id,taskId:'task-a'}});
    const decision=cp.schedulerDecision(run,task,{
      locks:cp.locks.list(),
      providerHealth:{
        claude:{status:'READY'},
        codex:{status:'READY'}
      }
    });
    assert.equal(decision.eligible,false);
    assert.ok(decision.reasons.includes('LOCK_BUSY'));
    assert.equal(decision.schema,'aecp.scheduler-decision/v1');
    assert.deepEqual(decision.repositoryLocks,[key]);
  } finally {
    await cp.shutdown();
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('scheduler decision blocks unavailable providers and exhausted retries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-scheduler-provider-'));
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  try {
    const run={
      id:'run-provider',
      state:'RUNNING',
      sourceRoot:root,
      taskIds:['task-1'],
      maxIterations:2,
      providers:{planner:'claude',builder:'codex',reviewer:'claude'},
      models:{planner:null,builder:null,reviewer:null},
      providerApprovals:{network:false,credential:false}
    };
    const task={id:'task-1',runId:run.id,state:'QUEUED',risk:'GREEN',priority:70,attempts:2,dependencies:[],resources:{repositories:[root]}};
    cp.state.runs[run.id]=run;cp.state.tasks[task.id]=task;
    const decision=cp.schedulerDecision(run,task,{
      locks:[],
      providerHealth:{claude:{status:'READY'},codex:{status:'UNAVAILABLE',detail:'not installed'}}
    });
    assert.equal(decision.eligible,false);
    assert.ok(decision.reasons.includes('RETRY_BUDGET_EXHAUSTED'));
    assert.ok(decision.reasons.includes('PROVIDER_BUILDER_UNAVAILABLE'));
    assert.equal(decision.retryRemaining,0);
  } finally {
    await cp.shutdown();
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('scheduler candidate ordering is deterministic by priority risk cost runtime then age', () => {
  const { compareSchedulerCandidates } = require('../electron/lib/control-plane.cjs');
  const items=[
    {taskId:'late',priority:50,risk:1,estimatedCostUnits:1,estimatedRuntimeMs:100,createdAt:'2026-01-02T00:00:00Z'},
    {taskId:'high-risk',priority:80,risk:2,estimatedCostUnits:1,estimatedRuntimeMs:100,createdAt:'2026-01-01T00:00:00Z'},
    {taskId:'high-safe-expensive',priority:80,risk:0,estimatedCostUnits:2,estimatedRuntimeMs:100,createdAt:'2026-01-01T00:00:00Z'},
    {taskId:'high-safe-cheap',priority:80,risk:0,estimatedCostUnits:1,estimatedRuntimeMs:200,createdAt:'2026-01-01T00:00:00Z'},
    {taskId:'high-safe-cheap-fast',priority:80,risk:0,estimatedCostUnits:1,estimatedRuntimeMs:50,createdAt:'2026-01-01T00:00:00Z'}
  ];
  items.sort(compareSchedulerCandidates);
  assert.deepEqual(items.map(x=>x.taskId),[
    'high-safe-cheap-fast',
    'high-safe-cheap',
    'high-safe-expensive',
    'high-risk',
    'late'
  ]);
});

test('heartbeat renews task-owned lock leases with the task id', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-task-lock-renew-'));
  const cp=new ControlPlane({rootDir:path.join(root,'runtime')});
  await cp.init();
  try{
    const workspace=path.join(root,'workspace');
    await fs.mkdir(workspace,{recursive:true});
    const run={id:'run-renew',state:'RUNNING',taskIds:['task-renew'],sourceRoot:workspace};
    cp.state.runs[run.id]=run;
    const key='repo:'+path.resolve(workspace).toLowerCase();
    const lock=await cp.locks.acquire(key,'task-renew',{leaseMs:1000,meta:{runId:run.id,taskId:'task-renew'}});
    cp.state.tasks['task-renew']={
      id:'task-renew',
      runId:run.id,
      state:'RUNNING',
      lease:{id:'lease',owner:'task-renew',processId:process.pid,expiresAt:new Date(Date.now()+1000).toISOString()},
      lockLeases:[{key,token:lock.token,expiresAt:lock.expiresAt}]
    };
    const before=Date.parse(lock.expiresAt);
    await new Promise(resolve=>setTimeout(resolve,5));
    await cp.heartbeat();
    const renewed=cp.locks.list().find(x=>x.key===key);
    assert.equal(renewed.owner,'task-renew');
    assert.equal(renewed.meta.taskId,'task-renew');
    assert.ok(Date.parse(renewed.expiresAt)>before);
    assert.ok(Date.parse(cp.state.tasks['task-renew'].lockLeases[0].expiresAt)>=Date.parse(renewed.expiresAt));
  } finally {
    await cp.shutdown();
    await fs.rm(root,{recursive:true,force:true});
  }
});
