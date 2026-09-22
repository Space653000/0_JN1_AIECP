'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ProviderRouter } = require('./provider-router.cjs');
const { redactSensitive } = require('./redaction.cjs');
const { makeExecutionContract, updateExecutionContract, validateExecutionContract } = require('./execution-contract.cjs');

const HARNESS_SCHEMA = 'aecp.harness/v1';
const MAX_OUTPUT = 1024 * 1024;
const DEFAULT_MAX_PATCH_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CHANGED_FILES = 100;

const STATES = Object.freeze([
  'PLANNING', 'READY', 'RUNNING', 'VERIFYING', 'REVIEWING',
  'REWORK', 'DONE', 'BLOCKED', 'BUDGET_EXHAUSTED',
  'HUMAN_REQUIRED', 'FAILED', 'CANCELLED'
]);

const DEFAULT_ROLE_PROVIDERS = Object.freeze({
  planner: 'claude',
  builder: 'codex',
  reviewer: 'claude'
});

const ROLES = Object.freeze({
  planner: { id: 'planner', label: 'Planner', defaultProvider: DEFAULT_ROLE_PROVIDERS.planner },
  builder: { id: 'builder', label: 'Builder', defaultProvider: DEFAULT_ROLE_PROVIDERS.builder },
  reviewer: { id: 'reviewer', label: 'Reviewer', defaultProvider: DEFAULT_ROLE_PROVIDERS.reviewer }
});

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function platformCommand(command) {
  const value = String(command || '');
  if (process.platform !== 'win32') return value;
  const fixed = {
    npm: 'npm.cmd',
    npx: 'npx.cmd',
    pnpm: 'pnpm.cmd',
    yarn: 'yarn.cmd'
  };
  return fixed[value.toLowerCase()] || value;
}

function text(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function bounded(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function optionalNumberBudget(value, min, max) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}

function providerReportedCost(usage, depth = 0) {
  if (depth > 4 || usage == null || typeof usage !== 'object' || Array.isArray(usage)) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number' && Number.isFinite(value) && /cost|price|credit/i.test(key)) total += Math.max(0, value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) total += providerReportedCost(value, depth + 1);
  }
  return total;
}

function safeJson(raw) {
  const s = String(raw || '').trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '');
  const unwrap = (value) => {
    if (!value || typeof value !== 'object') return value;
    for (const key of ['result', 'output', 'response', 'text']) {
      if (typeof value[key] === 'string') {
        const nested = safeJson(value[key]);
        if (nested) return nested;
      }
    }
    return value;
  };
  try { return unwrap(JSON.parse(s)); } catch {}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return unwrap(JSON.parse(s.slice(start, end + 1))); } catch {}
  }
  return null;
}

function runProcess(command, args, options = {}) {
  const { cwd, env = {}, timeoutMs = 120000, signal, maxOutputBytes = MAX_OUTPUT } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(platformCommand(command), args, {
      cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), timedOut = false, aborted = false, outputLimitExceeded = false;
    const append = (buf, chunk) => {
      if (outputLimitExceeded) return buf;
      const next = Buffer.concat([buf, Buffer.from(chunk)]);
      if (next.length > maxOutputBytes) {
        outputLimitExceeded = true;
        kill(child);
        return buf;
      }
      return next;
    };
    child.stdout.on('data', c => { stdout = append(stdout, c); });
    child.stderr.on('data', c => { stderr = append(stderr, c); });
    const timer = setTimeout(() => { timedOut = true; kill(child); }, Math.max(1000, timeoutMs));
    const abort = () => { aborted = true; kill(child); };
    if (signal) signal.aborted ? abort() : signal.addEventListener('abort', abort, { once: true });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      resolve({ code: Number.isInteger(code) ? code : -1, timedOut, aborted, outputLimitExceeded,
        stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
    });
  });
}

function assertProcessPolicy(policy,cwd,approved=false){ if(policy?.assert) policy.assert({action:'EXECUTE',path:cwd,approved}); }

async function invokeRole({router,role,prompt,cwd,model,providerId,policy,signal,timeoutMs,executionApproved=false,networkApproved=false,credentialApproved=false}){
  const capabilities=router.capabilities(role,providerId,{model});
  if(!capabilities) throw new Error(`No provider for role: ${role}`);
  if(capabilities.process) assertProcessPolicy(policy,cwd,executionApproved);
  if(capabilities.network && policy?.assert) policy.assert({action:'NETWORK',path:cwd,approved:networkApproved});
  if(capabilities.credential && policy?.assert) policy.assert({action:'CREDENTIAL',path:cwd,approved:credentialApproved});
  return router.execute(role,prompt,{provider:providerId,model,cwd,signal,timeoutMs,networkApproved,credentialApproved,maxOutputBytes:MAX_OUTPUT});
}

function kill(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref();
  else child.kill('SIGTERM');
}

async function git(cwd, args, signal) {
  const r = await runProcess('git', args, { cwd, signal, timeoutMs: 30000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().slice(0, 2000));
  return r.stdout.trim();
}

async function canonicalPathForCompare(value) {
  const resolved = path.resolve(String(value || ''));
  const physical = await fs.realpath(resolved).catch(() => resolved);
  const normalized = path.normalize(physical);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function assertCleanRepo(root, signal) {
  const top = await git(root, ['rev-parse', '--show-toplevel'], signal);
  const real = await canonicalPathForCompare(root);
  const actual = await canonicalPathForCompare(top);
  if (real !== actual) throw new Error('Harness requires Workspace root to be the Git repository root.');
  const status = await git(root, ['status', '--porcelain'], signal);
  if (status) throw new Error('Workspace must be clean before a Harness run.');
  return { head: await git(root, ['rev-parse', 'HEAD'], signal) };
}

async function makeWorktree(root, runRoot, signal, baseRef = null) {
  const base = await assertCleanRepo(root, signal);
  const worktree = path.join(runRoot, 'worktree');
  await fs.rm(worktree, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const ref = baseRef || base.head;
  await git(root, ['worktree', 'add', '--detach', worktree, ref], signal);
  return { worktree, baseHead: base.head };
}

async function verify(worktree, command, args, signal) {
  const started = Date.now();
  const r = await runProcess(command, args, { cwd: worktree, signal, timeoutMs: 180000 });
  return { passed: r.code === 0 && !r.timedOut && !r.aborted && !r.outputLimitExceeded, code: r.code, durationMs: Math.max(0, Date.now() - started),
    timedOut: r.timedOut, aborted: r.aborted, outputLimitExceeded: Boolean(r.outputLimitExceeded), command: [command, ...args].join(' '),
    stdout: r.stdout.slice(-20000), stderr: r.stderr.slice(-20000) };
}

function cli(role, prompt, cwd, model, providerId, router = new ProviderRouter()) {
  const provider = providerId || DEFAULT_ROLE_PROVIDERS[role];
  if (!provider) throw new Error(`No default provider for role: ${role}`);
  return router.commandSpec(provider, role, prompt, { model, cwd });
}

function normalizePlan(plan, goal, done, maxTasks) {
  const source = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const tasks = source.slice(0, maxTasks).map((t, i) => ({
    id: text(t.task_id || t.id, 100) || id(`task-${i + 1}`),
    title: text(t.title || t.objective, 160) || `Task ${i + 1}`,
    objective: text(t.objective || t.description, 3000),
    acceptance: text(t.acceptance || done, 3000),
    dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(x => text(x, 100)).filter(Boolean) : [],
    verifier: t.verifier || null,
    risk: ['GREEN', 'YELLOW', 'RED'].includes(t.risk) ? t.risk : 'YELLOW'
  })).filter(t => t.objective);
  if (!tasks.length) throw new Error('Planner returned no executable tasks.');
  return { schema: 'aecp.plan/v1', plan_id: id('plan'), goal, definition_of_done: done, tasks };
}

function plannerPrompt(goal, done, context) {
  return [
    'You are the AECP Planner. Produce a small executable software-engineering plan.',
    'Return ONLY JSON matching: {"tasks":[{"task_id":"T1","title":"...","objective":"...","acceptance":"...","dependencies":[],"risk":"GREEN|YELLOW|RED","verifier":"npm run verify"}]}',
    'Do not invent credentials, remote access, or permissions. Do not write code.',
    `GOAL:\n${goal}`,
    `DEFINITION OF DONE:\n${done}`,
    `CONTEXT:\n${context}`,
    'Prefer 1-8 coherent tasks, each small enough for one isolated worker run.'
  ].join('\n\n');
}

function builderPrompt(task, goal, done, review) {
  return [
    'You are the AECP Builder. Work ONLY inside this isolated worktree.',
    'Do not commit, push, publish, alter credentials, install system software, or access files outside the worktree.',
    'Implement the smallest change that satisfies the task. Do not claim verification; AECP runs it.',
    `GOAL:\n${goal}`, `TASK:\n${JSON.stringify(task, null, 2)}`,
    review ? `PREVIOUS REVIEW / REQUIRED REWORK:\n${review}` : 'This is the first implementation attempt.'
  ].join('\n\n');
}

function reviewerPrompt(task, goal, done, diff, verification) {
  return [
    'You are the AECP Reviewer. Review evidence, not model confidence.',
    'Return ONLY JSON: {"result":"PASS|REWORK|HUMAN_REQUIRED","findings":[],"required_changes":[]}',
    `GOAL:\n${goal}`, `DEFINITION OF DONE:\n${done}`,
    `TASK:\n${JSON.stringify(task, null, 2)}`,
    `DIFF:\n${diff}`, `VERIFICATION:\n${JSON.stringify(verification, null, 2)}`,
    'PASS only when acceptance and evidence are sufficient. HUMAN_REQUIRED for permissions, credentials, destructive actions, or unresolved ambiguity.'
  ].join('\n\n');
}

async function diffSummary(worktree, signal) {
  const status = await git(worktree, ['status', '--short'], signal);
  const stat = await git(worktree, ['diff', '--stat', 'HEAD'], signal);
  return [status, stat].filter(Boolean).join('\n').slice(0, 6000);
}

async function createPatch(worktree, runRoot, signal, { maxPatchBytes = DEFAULT_MAX_PATCH_BYTES, maxChangedFiles = DEFAULT_MAX_CHANGED_FILES } = {}) {
  await git(worktree, ['add', '-N', '.'], signal);
  const names = await git(worktree, ['diff', '--name-only', 'HEAD'], signal);
  const changedFiles = names.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (changedFiles.length > maxChangedFiles) {
    throw Object.assign(new Error(`Changed-file budget exceeded (${changedFiles.length} > ${maxChangedFiles}).`), { code: 'CHANGED_FILE_BUDGET_EXHAUSTED' });
  }
  const r = await runProcess('git', ['diff', '--binary', '--no-ext-diff', 'HEAD'], {
    cwd: worktree, signal, timeoutMs: 30000, maxOutputBytes: maxPatchBytes + 1
  });
  if (r.outputLimitExceeded) {
    throw Object.assign(new Error(`Patch budget exceeded (maximum ${maxPatchBytes} bytes).`), { code: 'PATCH_BUDGET_EXHAUSTED' });
  }
  if (r.code !== 0) throw new Error(r.stderr.slice(0, 1500));
  const bytes = Buffer.byteLength(r.stdout);
  if (bytes > maxPatchBytes) {
    throw Object.assign(new Error(`Patch budget exceeded (${bytes} > ${maxPatchBytes}).`), { code: 'PATCH_BUDGET_EXHAUSTED' });
  }
  const file = path.join(runRoot, 'verified.patch');
  await fs.writeFile(file, r.stdout, 'utf8');
  const sha256 = crypto.createHash('sha256').update(r.stdout).digest('hex');
  return { file, bytes, sha256, changedFiles };
}

async function runHarness(options) {
  const goal = text(options.goal, 6000), done = text(options.done, 6000);
  if (goal.length < 5 || done.length < 5) throw new Error('Goal and Definition of Done are required.');
  const root = path.resolve(options.sourceRoot);
  const runRoot = path.resolve(options.runRoot || path.join(root, '.aecp', 'harness', id('run')));
  const maxIterations = bounded(options.maxIterations, 1, 5, 3);
  const maxTasks = bounded(options.maxTasks, 1, 8, 4);
  const checkpointEvery = bounded(options.checkpointEvery, 1, maxIterations, 1);
  const maxTurns = bounded(options.maxTurns, 1, 200, Math.max(3, 1 + (maxTasks * maxIterations * 2)));
  const maxFailedAttempts = bounded(options.maxFailedAttempts, 1, 20, maxTasks * maxIterations);
  const maxNoProgressAttempts = bounded(options.maxNoProgressAttempts, 1, 5, 2);
  const maxWallClockMs = options.maxWallClockMs == null ? null : bounded(options.maxWallClockMs, 1000, 24 * 60 * 60 * 1000, null);
  const maxProviderReportedCost = optionalNumberBudget(options.maxProviderReportedCost, 0.000001, 1000000000);
  const maxLocalComputeMs = options.maxLocalComputeMs == null ? null : bounded(options.maxLocalComputeMs, 1000, 24 * 60 * 60 * 1000, null);
  const maxPatchBytes = bounded(options.maxPatchBytes, 1024, 64 * 1024 * 1024, DEFAULT_MAX_PATCH_BYTES);
  const maxChangedFiles = bounded(options.maxChangedFiles, 1, 1000, DEFAULT_MAX_CHANGED_FILES);
  const signal = options.signal;
  const event = options.onEvent || (async () => {});
  const providerRouter = options.providerRouter || new ProviderRouter();
  const roleProviders = {
    planner: options.plannerProvider || DEFAULT_ROLE_PROVIDERS.planner,
    builder: options.builderProvider || DEFAULT_ROLE_PROVIDERS.builder,
    reviewer: options.reviewerProvider || DEFAULT_ROLE_PROVIDERS.reviewer
  };
  const roleModels = {
    planner: options.plannerModel || null,
    builder: options.builderModel || null,
    reviewer: options.reviewerModel || null
  };
  let record = null;
  if (options.resume) {
    try { record = JSON.parse(await fs.readFile(path.join(runRoot, 'harness.json'), 'utf8')); } catch {}
  }
  if (!record) record = { schema: HARNESS_SCHEMA, id: options.runId || id('harness'), state: 'PLANNING',
    goal, done, sourceRoot: root, runRoot, maxIterations, maxTasks, tasks: [], events: [], startedAt: new Date().toISOString() };
  record.maxIterations=maxIterations; record.maxTasks=maxTasks; record.checkpointEvery=checkpointEvery; record.maxTurns=maxTurns; record.maxFailedAttempts=maxFailedAttempts; record.maxNoProgressAttempts=maxNoProgressAttempts; record.maxWallClockMs=maxWallClockMs; record.maxProviderReportedCost=maxProviderReportedCost; record.maxLocalComputeMs=maxLocalComputeMs; record.maxPatchBytes=maxPatchBytes; record.maxChangedFiles=maxChangedFiles; record.providerCalls=Number(record.providerCalls||0); record.providerReportedCost=Number(record.providerReportedCost||0); record.localComputeMs=Number(record.localComputeMs||0); record.failedAttempts=Number(record.failedAttempts||0); record.noProgressAttempts=Number(record.noProgressAttempts||0); record.goal=goal; record.done=done; record.sourceRoot=root; record.runRoot=runRoot; record.providers=roleProviders; record.models=roleModels; record.providerApprovals={network:Boolean(options.providerNetworkApproved),credential:Boolean(options.providerCredentialApproved)};
  record.checkpoints=Array.isArray(record.checkpoints)?record.checkpoints:[];
  const suppliedExecutionContract = options.executionContract || record.executionContract || null;
  if (suppliedExecutionContract && !validateExecutionContract(suppliedExecutionContract).ok) throw new Error('Invalid canonical execution contract.');
  record.executionContract = suppliedExecutionContract || makeExecutionContract({
    goal,
    done,
    workspaceId: options.workspaceId || null,
    workspaceRoot: root,
    permissionPolicy: options.permissionPolicy || {
      mode: 'FULL_HARNESS',
      executionApproved: Boolean(options.executionApproved),
      networkApproved: Boolean(options.providerNetworkApproved),
      credentialApproved: Boolean(options.providerCredentialApproved),
      highRisk: 'HUMAN_REQUIRED'
    },
    taskIds: (record.tasks || []).map(task => task.id),
    resultCapsuleRef: `local://harness/${record.id}/harness.json`,
    evidenceRef: `local://harness/${record.id}/verified.patch`,
    traceRef: `local://harness/${record.id}/harness.json`,
    transport: 'full-harness',
    worker: roleProviders.builder
  });
  record.loopContract={
    schema:'aecp.goal-loop/v1',
    goal,
    definitionOfDone:done,
    maxIterations,
    checkpointEvery,
    budgets:{
      maxTurns,
      maxFailedAttempts,
      maxNoProgressAttempts,
      maxWallClockMs,
      maxProviderReportedCost,
      maxLocalComputeMs,
      maxPatchBytes,
      maxChangedFiles
    },
    workspaceId:options.workspaceId||record.loopContract?.workspaceId||null,
    providerPolicy:options.providerPolicy||{
      planner:{provider:roleProviders.planner,model:roleModels.planner},
      builder:{provider:roleProviders.builder,model:roleModels.builder},
      reviewer:{provider:roleProviders.reviewer,model:roleModels.reviewer}
    },
    permissionPolicy:options.permissionPolicy||{
      executionApproved:Boolean(options.executionApproved),
      networkApproved:Boolean(options.providerNetworkApproved),
      credentialApproved:Boolean(options.providerCredentialApproved),
      highRisk:'HUMAN_REQUIRED'
    },
    verificationPolicy:options.verificationPolicy||{
      deterministicVerifierAuthoritative:true,
      reviewerRequired:true,
      workerSelfPassForbidden:true
    },
    stopConditions:Array.isArray(options.stopConditions)&&options.stopConditions.length?options.stopConditions:[
      'DONE_VERIFIED',
      'MAX_ITERATIONS',
      'MAX_FAILED_ATTEMPTS',
      'NO_PROGRESS',
      'WALL_CLOCK_BUDGET',
      'PROVIDER_CALL_BUDGET',
      'PROVIDER_COST_BUDGET',
      'LOCAL_COMPUTE_BUDGET',
      'OUTPUT_OR_PATCH_BUDGET',
      'PERMISSION_UNAVAILABLE',
      'HUMAN_APPROVAL_REQUIRED',
      'PROVIDER_UNAVAILABLE',
      'VERIFICATION_UNRESOLVED',
      'USER_CANCELLED'
    ]
  };
  const resumed=Boolean(options.resume && record.plan);
  const persist = async () => { record.updatedAt = new Date().toISOString(); await fs.mkdir(runRoot, { recursive: true }); await fs.writeFile(path.join(runRoot, 'harness.json'), JSON.stringify(redactSensitive(record), null, 2)); };
  const emit = async (type, data = {}) => { record.events.push({ at: new Date().toISOString(), type, state: record.state, data }); await persist(); await event(record.events.at(-1)); };
  const transition = async (state, data) => { if (!STATES.includes(state)) throw new Error(`Invalid Harness state: ${state}`); record.state = state; await emit(`state.${state.toLowerCase()}`, data); };
  const checkpoint = async (task, iteration, recommendation, changesSinceLastCheckpoint = '') => {
    if (iteration % checkpointEvery !== 0 && recommendation === 'NEXT_ITERATION') return null;
    const capsule = {
      schema:'aecp.goal-loop-checkpoint/v1',
      goal,
      currentIteration:iteration,
      taskId:task?.id||null,
      completedEvidence:(record.tasks||[]).filter(item=>item.verification?.passed).map(item=>({
        taskId:item.id,
        verifier:item.verification?.command||null,
        passed:Boolean(item.verification?.passed),
        review:item.review?.result||null
      })),
      unresolvedUncertainty:task?.review?.required_changes||[],
      currentRisks:[task?.risk].filter(Boolean),
      changesSinceLastCheckpoint:text(changesSinceLastCheckpoint,6000),
      recommendation
    };
    record.checkpoints.push(capsule);
    await emit('loop.checkpoint', capsule);
    return capsule;
  };
  const assertRuntimeBudget = () => {
    if (maxWallClockMs != null && Date.now() - Date.parse(record.startedAt) >= maxWallClockMs) {
      throw Object.assign(new Error(`Wall-clock budget exhausted (${maxWallClockMs} ms).`), { code: 'WALL_CLOCK_BUDGET_EXHAUSTED' });
    }
    if (record.failedAttempts >= maxFailedAttempts) {
      throw Object.assign(new Error(`Failed-attempt budget exhausted (${record.failedAttempts}/${maxFailedAttempts}).`), { code: 'FAILED_ATTEMPT_BUDGET_EXHAUSTED' });
    }
    if (maxProviderReportedCost != null && record.providerReportedCost > maxProviderReportedCost) {
      throw Object.assign(new Error(`Provider-reported cost budget exhausted (${record.providerReportedCost} > ${maxProviderReportedCost}).`), { code: 'PROVIDER_COST_BUDGET_EXHAUSTED' });
    }
    if (maxLocalComputeMs != null && record.localComputeMs > maxLocalComputeMs) {
      throw Object.assign(new Error(`Local compute budget exhausted (${record.localComputeMs} ms > ${maxLocalComputeMs} ms).`), { code: 'LOCAL_COMPUTE_BUDGET_EXHAUSTED' });
    }
  };
  const noteFailedAttempt = () => { record.failedAttempts += 1; };
  const observeProgress = (summary) => {
    const fingerprint = crypto.createHash('sha256').update(String(summary||'')).digest('hex');
    if (record.lastProgressFingerprint === fingerprint) record.noProgressAttempts += 1;
    else record.noProgressAttempts = 0;
    record.lastProgressFingerprint = fingerprint;
    if (record.noProgressAttempts >= maxNoProgressAttempts) {
      throw Object.assign(new Error(`No measurable progress across ${record.noProgressAttempts + 1} consecutive attempts.`), { code: 'NO_PROGRESS_STOP' });
    }
  };
  const invokeProvider = async (args) => {
    assertRuntimeBudget();
    if (record.providerCalls >= maxTurns) {
      throw Object.assign(new Error(`Provider call budget exhausted (${record.providerCalls}/${maxTurns}).`), { code: 'PROVIDER_CALL_BUDGET_EXHAUSTED' });
    }
    record.providerCalls += 1;
    const capabilities = providerRouter.capabilities(args.role, args.providerId, { model: args.model }) || {};
    const started = Date.now();
    await emit('provider.call', { role: args.role, providerId: args.providerId, count: record.providerCalls, maxTurns });
    const result = await invokeRole(args);
    const elapsed = Math.max(0, Date.now() - started);
    if (!capabilities.network) record.localComputeMs += elapsed;
    record.providerReportedCost += providerReportedCost(result.usage);
    await emit('provider.budget', {
      providerId: args.providerId,
      providerCalls: record.providerCalls,
      providerReportedCost: record.providerReportedCost,
      localComputeMs: record.localComputeMs
    });
    assertRuntimeBudget();
    return result;
  };
  try {
    if (!resumed) {
      await transition('PLANNING');
      const p = await invokeProvider({router:providerRouter,role:'planner',prompt:plannerPrompt(goal, done, text(options.context, 8000)),cwd:root,model:roleModels.planner,providerId:roleProviders.planner,policy:options.policy,signal,timeoutMs:180000,executionApproved:Boolean(options.executionApproved),networkApproved:Boolean(options.providerNetworkApproved),credentialApproved:Boolean(options.providerCredentialApproved)});
      if (p.code !== 0) throw new Error(`Planner failed: ${(p.stderr || p.stdout).slice(-2000)}`);
      const plan = normalizePlan(safeJson(p.stdout), goal, done, maxTasks);
      record.plan = plan; record.tasks = plan.tasks.map(t => ({ ...t, state: 'READY', iterations: 0 }));
      record.executionContract = updateExecutionContract(record.executionContract, {
        taskIds: record.tasks.map(task => task.id)
      });
      await transition('READY', { taskCount: record.tasks.length });
    } else {
      record.state='READY'; await emit('run.resumed',{taskCount:record.tasks.length});
    }
    let wt;
    if (record.worktree && await fs.stat(record.worktree).then(()=>true).catch(()=>false)) wt={worktree:record.worktree,baseHead:record.baseHead};
    else wt=await makeWorktree(root, runRoot, signal, options.baseRef || record.baseHead || null);
    record.worktree = wt.worktree; record.baseHead = record.baseHead || wt.baseHead; record.blueprintVersion = options.blueprintVersion || record.blueprintVersion || record.baseHead;
    for (const task of record.tasks) {
      if (signal?.aborted) throw Object.assign(new Error('Harness cancelled.'), { name: 'AbortError' });
      if (task.state === 'DONE') continue;
      if (task.state === 'HUMAN_REQUIRED') { await transition('HUMAN_REQUIRED', { taskId: task.id, reason: 'resume-human-gate' }); break; }
      if (task.dependencies.some(d => !record.tasks.find(x => x.id === d && x.state === 'DONE'))) {
        task.state = 'BLOCKED'; continue;
      }
      let review = '';
      let accepted = false;
      const resumeIteration = Math.max(1, Math.min(maxIterations, Number(task.iterations) || 1));
      for (let iteration = resumeIteration; iteration <= maxIterations; iteration++) {
        task.iterations = iteration; await transition('RUNNING', { taskId: task.id, iteration });
        const b = await invokeProvider({router:providerRouter,role:'builder',prompt:builderPrompt(task, goal, done, review),cwd:wt.worktree,model:roleModels.builder,providerId:roleProviders.builder,policy:options.policy,signal,timeoutMs:600000,executionApproved:Boolean(options.executionApproved),networkApproved:Boolean(options.providerNetworkApproved),credentialApproved:Boolean(options.providerCredentialApproved)});
        task.worker = { provider: b.provider || roleProviders.builder, model: b.model || roleModels.builder || null, command: b.command || b.provider || roleProviders.builder, code: b.code, timedOut: b.timedOut, aborted: Boolean(b.aborted), outputLimitExceeded: Boolean(b.outputLimitExceeded), stdout: b.stdout.slice(-12000), stderr: b.stderr.slice(-12000) };
        if (b.code !== 0 || b.timedOut) { noteFailedAttempt(); review = `Worker failed: ${(b.stderr || b.stdout).slice(-4000)}`; await transition('REWORK', { taskId: task.id, reason: 'worker-failed' }); await checkpoint(task, iteration, 'NEXT_ITERATION', review); continue; }
        await transition('VERIFYING', { taskId: task.id });
        const verifier = task.verifier === 'npm test'
          ? ['npm', ['test']] : ['npm', ['run', 'verify']];
        assertProcessPolicy(options.policy, wt.worktree, Boolean(options.executionApproved));
        const v = await verify(wt.worktree, verifier[0], verifier[1], signal);
        record.localComputeMs += Number(v.durationMs || 0);
        assertRuntimeBudget();
        task.verification = v;
        if (!v.passed) { noteFailedAttempt(); observeProgress(await diffSummary(wt.worktree, signal)); review = `Deterministic verification failed.\n${v.stderr.slice(-5000)}`; await transition('REWORK', { taskId: task.id, reason: 'verification-failed' }); await checkpoint(task, iteration, iteration===maxIterations?'STOP':'NEXT_ITERATION', review); continue; }
        await transition('REVIEWING', { taskId: task.id });
        const diff = await diffSummary(wt.worktree, signal);
        const rr = await invokeProvider({router:providerRouter,role:'reviewer',prompt:reviewerPrompt(task, goal, done, diff, v),cwd:root,model:roleModels.reviewer,providerId:roleProviders.reviewer,policy:options.policy,signal,timeoutMs:180000,executionApproved:Boolean(options.executionApproved),networkApproved:Boolean(options.providerNetworkApproved),credentialApproved:Boolean(options.providerCredentialApproved)});
        if (rr.code !== 0) { noteFailedAttempt(); review = `Reviewer failed: ${(rr.stderr || rr.stdout).slice(-3000)}`; continue; }
        const report = safeJson(rr.stdout);
        task.review = report || { result: 'HUMAN_REQUIRED', findings: ['Reviewer did not return valid JSON.'], required_changes: [] };
        if (task.review.result === 'PASS') {
          task.state = 'DONE'; accepted = true; await emit('task.review_passed', { taskId: task.id, iteration }); await checkpoint(task, iteration, 'CONTINUE', diff); break;
        }
        if (task.review.result === 'HUMAN_REQUIRED') { task.state = 'HUMAN_REQUIRED'; await transition('HUMAN_REQUIRED', { taskId: task.id }); await checkpoint(task, iteration, 'ASK_USER', diff); break; }
        noteFailedAttempt();
        observeProgress(diff);
        review = JSON.stringify(task.review);
        await transition('REWORK', { taskId: task.id, reason: 'review-rework' });
        await checkpoint(task, iteration, iteration===maxIterations?'STOP':'NEXT_ITERATION', diff);
      }
      if (!accepted && task.state !== 'HUMAN_REQUIRED') { task.state = 'BLOCKED'; await transition('BLOCKED', { taskId: task.id, reason: 'iteration-budget-exhausted' }); break; }
    }
    if (record.tasks.every(t => t.state === 'DONE')) {
      record.state = 'VERIFYING'; await emit('run.final_verification', {});
      record.patch = await createPatch(wt.worktree, runRoot, signal, { maxPatchBytes, maxChangedFiles });
      record.executionContract = updateExecutionContract(record.executionContract, {
        taskIds: record.tasks.map(task => task.id),
        resultCapsuleRef: `local://harness/${record.id}/harness.json`,
        evidenceRef: `local://harness/${record.id}/verified.patch`,
        traceRef: `local://harness/${record.id}/harness.json`
      });
      for (const task of record.tasks) {
        await emit('task.accepted', { taskId: task.id, iteration: task.iterations, patchSha256: record.patch.sha256 });
      }
      await transition('DONE', { patch: record.patch });
    } else if (record.tasks.some(t => t.state === 'HUMAN_REQUIRED')) await transition('HUMAN_REQUIRED');
    else await transition('BLOCKED');
    return record;
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) { record.error = 'Cancelled'; await transition('CANCELLED'); }
    else if (e?.code === 'APPROVAL_REQUIRED') {
      record.error = text(e?.message || e, 4000);
      record.requiredAction = e?.policy?.action || e?.action || null;
      await transition('HUMAN_REQUIRED', { reason: 'policy-approval-required', action: record.requiredAction, error: record.error });
    }
    else if (['PROVIDER_CALL_BUDGET_EXHAUSTED','FAILED_ATTEMPT_BUDGET_EXHAUSTED','WALL_CLOCK_BUDGET_EXHAUSTED','PROVIDER_COST_BUDGET_EXHAUSTED','LOCAL_COMPUTE_BUDGET_EXHAUSTED','PATCH_BUDGET_EXHAUSTED','CHANGED_FILE_BUDGET_EXHAUSTED'].includes(e?.code)) {
      record.error = text(e?.message || e, 4000);
      const activeTask=(record.tasks||[]).find(task=>!['DONE','HUMAN_REQUIRED','BLOCKED'].includes(task.state));
      if(activeTask){activeTask.state='BLOCKED';activeTask.stopReason=e.code;}
      await transition('BUDGET_EXHAUSTED', { reason: e.code, error: record.error });
    } else if (e?.code === 'NO_PROGRESS_STOP') {
      record.error = text(e?.message || e, 4000);
      const activeTask=(record.tasks||[]).find(task=>!['DONE','HUMAN_REQUIRED','BLOCKED'].includes(task.state));
      if(activeTask){activeTask.state='BLOCKED';activeTask.stopReason=e.code;}
      await transition('BLOCKED', { reason: e.code, error: record.error });
    } else { record.error = text(e?.message || e, 4000); await transition('FAILED', { error: record.error }); }
    return record;
  }
}

module.exports = { HARNESS_SCHEMA, STATES, ROLES, DEFAULT_ROLE_PROVIDERS, cli, invokeRole, runHarness, safeJson, normalizePlan };
