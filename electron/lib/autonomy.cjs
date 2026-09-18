'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const AUTONOMY_SCHEMA = 'aecp.autonomous/v1';
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 8 * 1024 * 1024;

const VERIFICATION_PROFILES = Object.freeze({
  'npm-verify': { id: 'npm-verify', label: 'npm run verify', command: 'npm', args: ['run', 'verify'], timeoutMs: 180000 },
  'npm-test': { id: 'npm-test', label: 'npm test', command: 'npm', args: ['test'], timeoutMs: 180000 },
  'pytest': { id: 'pytest', label: 'python -m pytest -q', command: 'python', args: ['-m', 'pytest', '-q'], timeoutMs: 180000 },
  'unittest': { id: 'unittest', label: 'python -m unittest', command: 'python', args: ['-m', 'unittest'], timeoutMs: 180000 }
});

const AUTONOMOUS_WORKERS = Object.freeze({
  opencode: { id: 'opencode', label: 'OpenCode', command: 'opencode', safety: 'permission-scoped' },
  'codex-cli': { id: 'codex-cli', label: 'Codex CLI', command: 'codex', safety: 'workspace-write-sandbox' }
});

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function validateAutonomySpec(input = {}) {
  const goal = cleanText(input.goal, 6000);
  const done = cleanText(input.done, 6000);
  const workerId = cleanText(input.workerId || 'opencode', 80);
  const verificationProfile = cleanText(input.verificationProfile, 80);

  if (goal.length < 5) throw new Error('Autonomous Goal must be at least 5 characters.');
  if (done.length < 5) throw new Error('Definition of Done must be at least 5 characters.');
  if (!AUTONOMOUS_WORKERS[workerId]) throw new Error('Selected worker is not enabled for bounded autonomous execution.');
  if (!VERIFICATION_PROFILES[verificationProfile]) throw new Error('Choose a supported deterministic verification profile.');

  return {
    schema: AUTONOMY_SCHEMA,
    goal,
    done,
    workerId,
    verificationProfile,
    maxIterations: clampInteger(input.maxIterations, 1, 12, 4),
    iterationTimeoutSeconds: clampInteger(input.iterationTimeoutSeconds, 30, 1800, 300),
    checkpointEvery: clampInteger(input.checkpointEvery, 1, 6, 1),
    model: cleanText(input.model, 160) || null
  };
}

function parseMajor(versionText) {
  const match = String(versionText || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? Number(match[1]) : 1;
}

function openCodeV1Config() {
  return {
    permission: {
      '*': 'deny',
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      bash: {
        '*': 'deny',
        'git status*': 'allow',
        'git diff*': 'allow'
      },
      external_directory: 'deny',
      doom_loop: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      task: 'deny'
    }
  };
}

function openCodeV2Config() {
  return {
    permissions: [
      { action: 'external_directory', resource: '*', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'shell', resource: 'git status *', effect: 'allow' },
      { action: 'shell', resource: 'git diff *', effect: 'allow' },
      { action: 'read', resource: '*', effect: 'allow' },
      { action: 'edit', resource: '*', effect: 'allow' },
      { action: 'glob', resource: '*', effect: 'allow' },
      { action: 'grep', resource: '*', effect: 'allow' },
      { action: 'webfetch', resource: '*', effect: 'deny' },
      { action: 'websearch', resource: '*', effect: 'deny' },
      { action: 'subagent', resource: '*', effect: 'deny' },
      { action: 'skill', resource: '*', effect: 'deny' }
    ]
  };
}

function buildOpenCodeInvocation({ prompt, cwd, model, versionText }) {
  const major = parseMajor(versionText);
  const args = ['run'];
  if (major < 2) args.push('--auto');
  args.push('--format', 'json', '--dir', cwd);
  if (model) args.push('--model', model);
  args.push(prompt);
  return {
    command: 'opencode',
    args,
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(major >= 2 ? openCodeV2Config() : openCodeV1Config())
    }
  };
}

function buildCodexInvocation({ prompt, cwd, model }) {
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'workspace-write',
    '--json',
    '--cd', cwd,
    '-c', 'sandbox_workspace_write.network_access=false'
  ];
  if (model) args.push('--model', model);
  args.push(prompt);
  return { command: 'codex', args, env: {} };
}

function buildWorkerInvocation(workerId, options) {
  if (workerId === 'opencode') return buildOpenCodeInvocation(options);
  if (workerId === 'codex-cli') return buildCodexInvocation(options);
  throw new Error('Worker adapter is not implemented.');
}

function buildIterationPrompt(spec, context = {}) {
  const iteration = context.iteration || 1;
  const previous = cleanText(context.previousVerification, 5000);
  const diff = cleanText(context.diffSummary, 3000);
  return [
    'You are an AECP bounded autonomous coding worker.',
    '',
    'HARD BOUNDARIES',
    '- Work only inside the current isolated Git worktree.',
    '- Do not commit, push, publish, change credentials, install system software, or modify files outside the worktree.',
    '- Do not claim tests passed. AECP runs deterministic verification after you return.',
    '- Make the smallest coherent change that advances the Goal and Definition of Done.',
    '- If blocked by missing credentials, external approval, or unavailable dependencies, explain the blocker instead of bypassing it.',
    '',
    'GOAL',
    spec.goal,
    '',
    'DEFINITION OF DONE',
    spec.done,
    '',
    `ITERATION ${iteration} OF ${spec.maxIterations}`,
    previous ? `PREVIOUS VERIFICATION OUTPUT\n${previous}` : 'PREVIOUS VERIFICATION OUTPUT\nNone; this is the first iteration.',
    diff ? `CURRENT DIFF SUMMARY\n${diff}` : 'CURRENT DIFF SUMMARY\nNo prior diff summary.',
    '',
    'Do the next highest-value implementation step now. Keep changes focused. Return a concise summary of what you changed and what AECP should verify.'
  ].join('\n');
}

function makeRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `auto-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.unref();
    } else {
      child.kill('SIGTERM');
    }
  } catch {}
}

function runProcess(command, args, options = {}) {
  const {
    cwd,
    env = {},
    timeoutMs = 120000,
    signal,
    input = null,
    maxOutputBytes = MAX_OUTPUT_BYTES
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let aborted = false;

    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      return next.length > maxOutputBytes ? next.subarray(next.length - maxOutputBytes) : next;
    };

    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, Math.max(1000, timeoutMs));

    const onAbort = () => {
      aborted = true;
      killProcessTree(child);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (error) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    });

    child.on('close', (code, childSignal) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        code: Number.isInteger(code) ? code : -1,
        signal: childSignal || null,
        timedOut,
        aborted,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8')
      });
    });

    if (input != null) child.stdin.end(String(input));
    else child.stdin.end();
  });
}

async function git(root, args, options = {}) {
  const result = await runProcess('git', args, { cwd: root, timeoutMs: options.timeoutMs || 30000, signal: options.signal });
  if (result.code !== 0) {
    const error = new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim().slice(0, 1200)}`);
    error.result = result;
    throw error;
  }
  return result.stdout.trim();
}

async function assertCleanGitRoot(sourceRoot, signal) {
  const top = await git(sourceRoot, ['rev-parse', '--show-toplevel'], { signal });
  if (path.resolve(top) !== path.resolve(sourceRoot)) throw new Error('Bounded autonomous execution currently requires the Workspace itself to be a Git repository root.');
  const status = await git(sourceRoot, ['status', '--porcelain'], { signal });
  if (status.trim()) throw new Error('Workspace repository must be clean before starting autonomous execution. Commit/stash/discard existing changes first.');
  const head = await git(sourceRoot, ['rev-parse', 'HEAD'], { signal });
  return { top, head };
}

async function maybeLinkNodeModules(sourceRoot, worktree) {
  const source = path.join(sourceRoot, 'node_modules');
  const target = path.join(worktree, 'node_modules');
  try {
    const stat = await fs.stat(source);
    if (!stat.isDirectory()) return false;
    await fs.lstat(target);
    return false;
  } catch {}
  try {
    await fs.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}

async function prepareWorktree({ sourceRoot, runRoot, signal }) {
  const { head } = await assertCleanGitRoot(sourceRoot, signal);
  await fs.mkdir(runRoot, { recursive: true });
  const worktree = path.join(runRoot, 'worktree');
  try { await fs.rm(worktree, { recursive: true, force: true }); } catch {}
  await git(sourceRoot, ['worktree', 'add', '--detach', worktree, head], { signal, timeoutMs: 90000 });
  const linkedNodeModules = await maybeLinkNodeModules(sourceRoot, worktree);
  return { worktree, baseHead: head, linkedNodeModules };
}

async function diffSummary(worktree, signal) {
  const status = await git(worktree, ['status', '--short'], { signal });
  const stat = await git(worktree, ['diff', '--stat', 'HEAD'], { signal });
  return [status, stat].filter(Boolean).join('\n').slice(0, 5000);
}

async function runVerification(worktree, profileId, signal, runner = runProcess) {
  const profile = VERIFICATION_PROFILES[profileId];
  if (!profile) throw new Error('Unsupported verification profile.');
  const result = await runner(profile.command, profile.args, {
    cwd: worktree,
    timeoutMs: profile.timeoutMs,
    signal,
    maxOutputBytes: MAX_OUTPUT_BYTES
  });
  return {
    profile: profile.id,
    label: profile.label,
    command: [profile.command, ...profile.args].join(' '),
    passed: result.code === 0 && !result.timedOut && !result.aborted,
    code: result.code,
    timedOut: result.timedOut,
    aborted: result.aborted,
    stdout: result.stdout.slice(-20000),
    stderr: result.stderr.slice(-20000)
  };
}

async function createPatch({ worktree, runRoot, signal }) {
  await git(worktree, ['add', '-N', '.'], { signal });
  const result = await runProcess('git', ['diff', '--binary', '--no-ext-diff', 'HEAD'], {
    cwd: worktree,
    timeoutMs: 30000,
    signal,
    maxOutputBytes: MAX_PATCH_BYTES + 1024
  });
  if (result.code !== 0) throw new Error(`Unable to create patch: ${result.stderr.slice(0, 1000)}`);
  const bytes = Buffer.byteLength(result.stdout, 'utf8');
  if (bytes > MAX_PATCH_BYTES) throw new Error(`Autonomous patch is too large (${bytes} bytes; maximum ${MAX_PATCH_BYTES}).`);
  const patchFile = path.join(runRoot, 'verified.patch');
  await fs.writeFile(patchFile, result.stdout, 'utf8');
  return { patchFile, bytes };
}

async function applyVerifiedPatch({ sourceRoot, runRecord, signal }) {
  if (!runRecord || runRecord.state !== 'DONE' || !runRecord.patchFile) throw new Error('Only a verified DONE run can be applied.');
  const current = await assertCleanGitRoot(sourceRoot, signal);
  if (current.head !== runRecord.baseHead) throw new Error('Workspace HEAD changed since this autonomous run started. Refusing to apply a stale patch.');
  const patch = await fs.readFile(runRecord.patchFile);
  if (patch.length > MAX_PATCH_BYTES) throw new Error('Patch exceeds the configured safety limit.');
  if (!patch.length) return { applied: false, reason: 'no-changes' };

  const check = await runProcess('git', ['apply', '--check', runRecord.patchFile], { cwd: sourceRoot, timeoutMs: 30000, signal });
  if (check.code !== 0) throw new Error(`Verified patch no longer applies cleanly: ${(check.stderr || check.stdout).slice(0, 1200)}`);

  const applied = await runProcess('git', ['apply', runRecord.patchFile], { cwd: sourceRoot, timeoutMs: 30000, signal });
  if (applied.code !== 0) throw new Error(`Applying verified patch failed: ${(applied.stderr || applied.stdout).slice(0, 1200)}`);
  return { applied: true, status: await git(sourceRoot, ['status', '--short'], { signal }) };
}

async function runBoundedAutonomy(options, deps = {}) {
  const spec = validateAutonomySpec(options.spec);
  const sourceRoot = path.resolve(options.sourceRoot);
  const runRoot = path.resolve(options.runRoot);
  const signal = options.signal;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : async () => {};
  const processRunner = deps.runProcess || runProcess;
  const verifyRunner = deps.runVerification || ((worktree, profile, sig) => runVerification(worktree, profile, sig, processRunner));
  const workerProbe = deps.workerProbe || (async (workerId) => {
    const worker = AUTONOMOUS_WORKERS[workerId];
    const result = await processRunner(worker.command, ['--version'], { timeoutMs: 8000, signal });
    if (result.code !== 0) throw new Error(`${worker.label} is not installed or cannot be executed.`);
    return (result.stdout || result.stderr).trim().split(/\r?\n/)[0];
  });

  const runId = options.runId || makeRunId();
  const startedAt = new Date().toISOString();
  const record = {
    schema: AUTONOMY_SCHEMA,
    id: runId,
    state: 'PREPARING',
    sourceRoot,
    runRoot,
    workerId: spec.workerId,
    verificationProfile: spec.verificationProfile,
    goal: spec.goal,
    done: spec.done,
    maxIterations: spec.maxIterations,
    currentIteration: 0,
    startedAt,
    updatedAt: startedAt,
    iterations: []
  };

  const persist = async () => {
    record.updatedAt = new Date().toISOString();
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
  };
  const emit = async (type, data = {}) => {
    await persist();
    await onEvent({ schema: 'aecp.autonomy.event/v1', runId, at: new Date().toISOString(), type, state: record.state, data });
  };

  try {
    await emit('run.preparing', { workerId: spec.workerId });
    const workerVersion = await workerProbe(spec.workerId);
    record.workerVersion = workerVersion;

    const prepared = await prepareWorktree({ sourceRoot, runRoot, signal });
    record.worktree = prepared.worktree;
    record.baseHead = prepared.baseHead;
    record.linkedNodeModules = prepared.linkedNodeModules;
    record.state = 'RUNNING';
    await emit('worktree.ready', { worktree: prepared.worktree, baseHead: prepared.baseHead });

    let previousVerification = '';
    let currentDiff = '';

    for (let iteration = 1; iteration <= spec.maxIterations; iteration += 1) {
      if (signal?.aborted) throw Object.assign(new Error('Autonomous run cancelled.'), { name: 'AbortError' });
      record.currentIteration = iteration;
      record.state = 'RUNNING';
      await emit('iteration.started', { iteration, maxIterations: spec.maxIterations });

      const prompt = buildIterationPrompt(spec, {
        iteration,
        previousVerification,
        diffSummary: currentDiff
      });
      const invocation = buildWorkerInvocation(spec.workerId, {
        prompt,
        cwd: record.worktree,
        model: spec.model,
        versionText: workerVersion
      });

      const workerStarted = Date.now();
      const worker = await processRunner(invocation.command, invocation.args, {
        cwd: record.worktree,
        env: invocation.env,
        timeoutMs: spec.iterationTimeoutSeconds * 1000,
        signal,
        maxOutputBytes: MAX_OUTPUT_BYTES
      });

      const iterationRecord = {
        iteration,
        worker: {
          command: invocation.command,
          code: worker.code,
          timedOut: worker.timedOut,
          aborted: worker.aborted,
          durationMs: Date.now() - workerStarted,
          stdout: worker.stdout.slice(-20000),
          stderr: worker.stderr.slice(-20000)
        }
      };

      if (worker.aborted || signal?.aborted) throw Object.assign(new Error('Autonomous run cancelled.'), { name: 'AbortError' });
      if (worker.timedOut) {
        iterationRecord.verification = { passed: false, reason: 'worker-timeout' };
        record.iterations.push(iterationRecord);
        previousVerification = 'Worker timed out before AECP verification.';
        await emit('iteration.worker_timeout', { iteration });
        continue;
      }
      if (worker.code !== 0) {
        iterationRecord.verification = { passed: false, reason: 'worker-exit', code: worker.code };
        record.iterations.push(iterationRecord);
        previousVerification = `Worker exited with code ${worker.code}.\n${worker.stderr.slice(-4000)}`;
        await emit('iteration.worker_failed', { iteration, code: worker.code });
        continue;
      }

      record.state = 'VERIFYING';
      await emit('iteration.verifying', { iteration, profile: spec.verificationProfile });
      const verification = await verifyRunner(record.worktree, spec.verificationProfile, signal);
      currentDiff = await diffSummary(record.worktree, signal);
      iterationRecord.verification = verification;
      iterationRecord.diffSummary = currentDiff;
      record.iterations.push(iterationRecord);

      if (verification.passed) {
        record.state = 'DONE';
        record.completedAt = new Date().toISOString();
        const patch = await createPatch({ worktree: record.worktree, runRoot, signal });
        record.patchFile = patch.patchFile;
        record.patchBytes = patch.bytes;
        await emit('run.done', {
          iteration,
          patchBytes: patch.bytes,
          diffSummary: currentDiff,
          verification: verification.command
        });
        return record;
      }

      previousVerification = [
        `Verification command: ${verification.command}`,
        `Exit code: ${verification.code}`,
        verification.timedOut ? 'Verification timed out.' : '',
        verification.stdout ? `STDOUT:\n${verification.stdout.slice(-5000)}` : '',
        verification.stderr ? `STDERR:\n${verification.stderr.slice(-5000)}` : ''
      ].filter(Boolean).join('\n');
      record.state = iteration === spec.maxIterations ? 'BUDGET_EXHAUSTED' : 'RUNNING';
      await emit('iteration.failed_verification', {
        iteration,
        remaining: spec.maxIterations - iteration,
        command: verification.command
      });
    }

    record.state = 'BUDGET_EXHAUSTED';
    record.completedAt = new Date().toISOString();
    await emit('run.budget_exhausted', { iterations: spec.maxIterations });
    return record;
  } catch (error) {
    record.state = error?.name === 'AbortError' ? 'CANCELLED' : 'FAILED';
    record.completedAt = new Date().toISOString();
    record.error = String(error?.message || error);
    await emit(record.state === 'CANCELLED' ? 'run.cancelled' : 'run.failed', { error: record.error });
    return record;
  }
}

module.exports = {
  AUTONOMY_SCHEMA,
  AUTONOMOUS_WORKERS,
  VERIFICATION_PROFILES,
  validateAutonomySpec,
  parseMajor,
  openCodeV1Config,
  openCodeV2Config,
  buildWorkerInvocation,
  buildIterationPrompt,
  makeRunId,
  runProcess,
  assertCleanGitRoot,
  prepareWorktree,
  diffSummary,
  runVerification,
  createPatch,
  applyVerifiedPatch,
  runBoundedAutonomy
};
