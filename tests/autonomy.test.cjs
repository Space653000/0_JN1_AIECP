'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

const {
  validateAutonomySpec,
  buildWorkerInvocation,
  buildIterationPrompt,
  openCodeV1Config,
  prepareWorktree,
  applyVerifiedPatch,
  runBoundedAutonomy
} = require('../electron/lib/autonomy.cjs');

test('validates bounded autonomy spec', () => {
  const spec = validateAutonomySpec({
    goal: 'Implement the requested feature safely.',
    done: 'npm test passes and expected behavior is present.',
    workerId: 'opencode',
    verificationProfile: 'npm-test',
    maxIterations: 99,
    iterationTimeoutSeconds: 1
  });
  assert.equal(spec.maxIterations, 12);
  assert.equal(spec.iterationTimeoutSeconds, 30);
});

test('OpenCode v1 invocation carries deny-first inline policy', () => {
  const inv = buildWorkerInvocation('opencode', {
    prompt: 'Do work',
    cwd: 'C:\\repo',
    versionText: '1.18.30'
  });
  assert.equal(inv.command, 'opencode');
  assert.ok(inv.args.includes('--auto'));
  const config = JSON.parse(inv.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config, openCodeV1Config());
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.bash['*'], 'deny');
});

test('Codex invocation uses workspace-write sandbox and disables network', () => {
  const inv = buildWorkerInvocation('codex-cli', {
    prompt: 'Do work',
    cwd: 'C:\\repo'
  });
  assert.equal(inv.command, 'codex');
  assert.ok(inv.args.includes('workspace-write'));
  assert.ok(inv.args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(inv.args.includes('--ignore-user-config'));
});

test('iteration prompt makes AECP verification authoritative', () => {
  const spec = validateAutonomySpec({
    goal: 'Fix the bug.',
    done: 'Tests pass.',
    workerId: 'opencode',
    verificationProfile: 'npm-test'
  });
  const prompt = buildIterationPrompt(spec, { iteration: 2, previousVerification: 'failed test A' });
  assert.match(prompt, /Do not claim tests passed/);
  assert.match(prompt, /ITERATION 2/);
  assert.match(prompt, /failed test A/);
});

test('bounded runner isolates writes in worktree then applies only after explicit apply call', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-auto-'));
  const repo = path.join(root, 'repo');
  const runRoot = path.join(root, 'run');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'value.txt'), 'original\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'base'], { cwd: repo });

  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  const fakeProcess = async (_command, _args, options) => {
    await fs.writeFile(path.join(options.cwd, 'value.txt'), 'changed\n');
    return { code: 0, signal: null, timedOut: false, aborted: false, stdout: 'changed', stderr: '' };
  };

  const record = await runBoundedAutonomy({
    sourceRoot: repo,
    runRoot,
    spec: {
      goal: 'Change value safely.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 2
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: fakeProcess,
    runVerification: async () => ({
      profile: 'npm-test',
      label: 'fake',
      command: 'fake verify',
      passed: true,
      code: 0,
      timedOut: false,
      aborted: false,
      stdout: 'PASS',
      stderr: ''
    })
  });

  assert.equal(record.state, 'DONE', record.error || JSON.stringify(record, null, 2));
  assert.equal(record.executionContract.schema, 'aecp.execution-contract/v1');
  assert.equal(record.executionContract.transport, 'local-autonomous');
  assert.equal(path.resolve(record.executionContract.workspace.root), path.resolve(repo));
  assert.equal(record.executionContract.definitionOfDone, 'Verifier passes.');
  assert.equal(normalizeEol(await fs.readFile(path.join(repo, 'value.txt'), 'utf8')), 'original\n');
  assert.equal(normalizeEol(await fs.readFile(path.join(record.worktree, 'value.txt'), 'utf8')), 'changed\n');

  assert.match(record.patchSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(record.patchChangedFiles));
  const applied = await applyVerifiedPatch({ sourceRoot: repo, runRecord: record });
  assert.equal(applied.applied, true);
  assert.equal(normalizeEol(await fs.readFile(path.join(repo, 'value.txt'), 'utf8')), 'changed\n');
  const statusAfterApply = await exec('git', ['status', '--porcelain'], { cwd: repo });
  assert.match(normalizeEol(statusAfterApply.stdout), /value\.txt/);
});


test('autonomy stops with BUDGET_EXHAUSTED when worker output exceeds the configured bound', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-auto-output-budget-'));
  const repo = path.join(root, 'repo');
  const runRoot = path.join(root, 'run');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'value.txt'), 'original\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'base'], { cwd: repo });
  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  const record = await runBoundedAutonomy({
    sourceRoot: repo,
    runRoot,
    spec: {
      goal: 'Change value safely.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 2
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async () => ({
      code: -1,
      signal: null,
      timedOut: false,
      aborted: false,
      outputLimitExceeded: true,
      stdout: '',
      stderr: ''
    })
  });

  assert.equal(record.state, 'BUDGET_EXHAUSTED');
  assert.equal(record.iterations[0].verification.reason, 'worker-output-limit');
  assert.equal(record.maxTurns, record.maxIterations);
  assert.equal(record.maxOutputBytes, 1024 * 1024);
});

test('autonomy refuses a verified patch that exceeds changed-file budget', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-auto-file-budget-'));
  const repo = path.join(root, 'repo');
  const runRoot = path.join(root, 'run');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'value.txt'), 'original\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'base'], { cwd: repo });
  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  const fakeProcess = async (_command, _args, options) => {
    await fs.writeFile(path.join(options.cwd, 'one.txt'), 'one\n');
    await fs.writeFile(path.join(options.cwd, 'two.txt'), 'two\n');
    return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'changed', stderr: '' };
  };

  const record = await runBoundedAutonomy({
    sourceRoot: repo,
    runRoot,
    spec: {
      goal: 'Create two files.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 1,
      maxChangedFiles: 1
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: fakeProcess,
    runVerification: async () => ({
      profile: 'npm-test',
      label: 'fake',
      command: 'fake verify',
      passed: true,
      code: 0,
      timedOut: false,
      aborted: false,
      outputLimitExceeded: false,
      stdout: 'PASS',
      stderr: ''
    })
  });

  assert.equal(record.state, 'BUDGET_EXHAUSTED');
  assert.match(record.error, /Changed-file budget exceeded/);
});


async function makeAutonomyRepo(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repo = path.join(root, 'repo');
  const runRoot = path.join(root, 'run');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'value.txt'), 'original\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'base'], { cwd: repo });
  return { root, repo, runRoot };
}

test('dirty source repository blocks bounded autonomy before Worker execution', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-dirty-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture.repo, 'value.txt'), 'dirty\n');
  let workerRan = false;
  const record = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec: {
      goal: 'Attempt bounded work.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 1
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async () => { workerRan = true; return { code: 0, timedOut: false, aborted: false, stdout: '', stderr: '' }; }
  });
  assert.equal(record.state, 'FAILED');
  assert.match(record.error, /uncommitted changes|clean/i);
  assert.equal(workerRan, false);
});

test('failed verification triggers another bounded iteration and can then pass', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-retry-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  let workerCalls = 0;
  let verifyCalls = 0;
  const record = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec: {
      goal: 'Retry until deterministic verification passes.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 3
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      workerCalls++;
      await fs.writeFile(path.join(options.cwd, 'value.txt'), 'changed\n');
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'worker', stderr: '' };
    },
    runVerification: async () => {
      verifyCalls++;
      return {
        profile: 'npm-test', label: 'fake', command: 'fake verify',
        passed: verifyCalls >= 2, code: verifyCalls >= 2 ? 0 : 1,
        timedOut: false, aborted: false, outputLimitExceeded: false,
        stdout: verifyCalls >= 2 ? 'PASS' : '', stderr: verifyCalls >= 2 ? '' : 'FAIL'
      };
    }
  });
  assert.equal(record.state, 'DONE', record.error || JSON.stringify(record, null, 2));
  assert.equal(workerCalls, 2);
  assert.equal(verifyCalls, 2);
  assert.equal(record.iterations.length, 2);
});

test('max iteration limit terminates repeated verification failure as BUDGET_EXHAUSTED', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-max-iterations-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  let workerCalls = 0;
  const record = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec: {
      goal: 'Stay bounded when verification never passes.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 2
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async () => {
      workerCalls++;
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'worker', stderr: '' };
    },
    runVerification: async () => ({
      profile: 'npm-test', label: 'fake', command: 'fake verify',
      passed: false, code: 1, timedOut: false, aborted: false, outputLimitExceeded: false,
      stdout: '', stderr: 'still failing'
    })
  });
  assert.equal(record.state, 'BUDGET_EXHAUSTED');
  assert.equal(workerCalls, 2);
  assert.equal(record.iterations.length, 2);
});

test('cancellation aborts bounded autonomy instead of continuing another iteration', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-cancel-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  const controller = new AbortController();
  let workerCalls = 0;
  const record = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    signal: controller.signal,
    onEvent: async (event) => {
      if (event.type === 'iteration.started') controller.abort();
    },
    spec: {
      goal: 'Cancel bounded work safely.',
      done: 'Cancellation is terminal.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 3
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      workerCalls++;
      return { code: -1, signal: null, timedOut: false, aborted: Boolean(options.signal?.aborted), outputLimitExceeded: false, stdout: '', stderr: '' };
    }
  });
  assert.equal(record.state, 'CANCELLED');
  assert.equal(workerCalls, 1);
});

test('Apply refuses a verified patch after source HEAD changes', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-stale-head-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  const record = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec: {
      goal: 'Produce a verified patch.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 1
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      await fs.writeFile(path.join(options.cwd, 'value.txt'), 'changed\n');
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'worker', stderr: '' };
    },
    runVerification: async () => ({
      profile: 'npm-test', label: 'fake', command: 'fake verify',
      passed: true, code: 0, timedOut: false, aborted: false, outputLimitExceeded: false,
      stdout: 'PASS', stderr: ''
    })
  });
  assert.equal(record.state, 'DONE', record.error || JSON.stringify(record, null, 2));

  await fs.writeFile(path.join(fixture.repo, 'external.txt'), 'new HEAD\n');
  await exec('git', ['add', '.'], { cwd: fixture.repo });
  await exec('git', ['commit', '-m', 'external change'], { cwd: fixture.repo });

  await assert.rejects(
    () => applyVerifiedPatch({ sourceRoot: fixture.repo, runRecord: record }),
    /HEAD changed/
  );
});


test('Apply rejects a verified patch file modified after verification', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-tampered-patch-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  const record = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec: {
      goal: 'Produce a verified patch with integrity evidence.',
      done: 'Verifier passes.',
      workerId: 'opencode',
      verificationProfile: 'npm-test',
      maxIterations: 1
    }
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      await fs.writeFile(path.join(options.cwd, 'value.txt'), 'changed\n');
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'worker', stderr: '' };
    },
    runVerification: async () => ({
      profile: 'npm-test', label: 'fake', command: 'fake verify',
      passed: true, code: 0, timedOut: false, aborted: false, outputLimitExceeded: false,
      stdout: 'PASS', stderr: ''
    })
  });
  assert.equal(record.state, 'DONE', record.error || JSON.stringify(record, null, 2));
  assert.match(record.patchSha256, /^[a-f0-9]{64}$/);
  await fs.appendFile(record.patchFile, '\n# tampered after verification\n');
  await assert.rejects(
    () => applyVerifiedPatch({ sourceRoot: fixture.repo, runRecord: record }),
    /changed after verification/
  );
});


test('interrupted autonomy resumes from the same persisted worktree and next iteration', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-resume-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  const spec = validateAutonomySpec({
    goal: 'Resume the same bounded engineering run.',
    done: 'Verifier passes.',
    workerId: 'opencode',
    verificationProfile: 'npm-test',
    maxIterations: 3
  });
  const prepared = await prepareWorktree({ sourceRoot: fixture.repo, runRoot: fixture.runRoot });
  await fs.writeFile(path.join(prepared.worktree, 'checkpoint.txt'), 'iteration-one\n');
  const resumeRecord = {
    schema: 'aecp.autonomous/v1',
    id: 'auto-resume-test',
    state: 'INTERRUPTED',
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    workerId: spec.workerId,
    verificationProfile: spec.verificationProfile,
    goal: spec.goal,
    done: spec.done,
    spec,
    maxIterations: spec.maxIterations,
    maxTurns: spec.maxTurns,
    maxOutputBytes: spec.maxOutputBytes,
    maxPatchBytes: spec.maxPatchBytes,
    maxChangedFiles: spec.maxChangedFiles,
    currentIteration: 1,
    startedAt: new Date().toISOString(),
    worktree: prepared.worktree,
    baseHead: prepared.baseHead,
    linkedNodeModules: prepared.linkedNodeModules,
    iterations: [{
      iteration: 1,
      worker: { command: 'opencode', code: 0, timedOut: false, aborted: false },
      verification: { passed: false, command: 'fake verify', code: 1, stderr: 'iteration one failed' }
    }]
  };
  let workerCalls = 0;
  const record = await runBoundedAutonomy({
    runId: resumeRecord.id,
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec,
    resumeRecord
  }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      workerCalls++;
      assert.equal(path.resolve(options.cwd), path.resolve(prepared.worktree));
      await fs.writeFile(path.join(options.cwd, 'value.txt'), 'resumed\n');
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'resumed', stderr: '' };
    },
    runVerification: async () => ({
      profile: 'npm-test', label: 'fake', command: 'fake verify',
      passed: true, code: 0, timedOut: false, aborted: false, outputLimitExceeded: false,
      stdout: 'PASS', stderr: ''
    })
  });
  assert.equal(record.state, 'DONE', record.error || JSON.stringify(record, null, 2));
  assert.equal(record.id, resumeRecord.id);
  assert.equal(record.currentIteration, 2);
  assert.equal(record.iterations.length, 2);
  assert.equal(record.iterations[1].iteration, 2);
  assert.equal(workerCalls, 1);
  assert.equal(await fs.readFile(path.join(prepared.worktree, 'checkpoint.txt'), 'utf8'), 'iteration-one\n');
});

test('autonomy resume rejects source HEAD drift and specification mutation', async (t) => {
  const fixture = await makeAutonomyRepo('aecp-auto-resume-guard-');
  t.after(async () => fs.rm(fixture.root, { recursive: true, force: true }));
  const spec = validateAutonomySpec({
    goal: 'Resume safely.',
    done: 'Verifier passes.',
    workerId: 'opencode',
    verificationProfile: 'npm-test',
    maxIterations: 3
  });
  const prepared = await prepareWorktree({ sourceRoot: fixture.repo, runRoot: fixture.runRoot });
  const resumeRecord = {
    schema: 'aecp.autonomous/v1',
    id: 'auto-resume-guard',
    state: 'INTERRUPTED',
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    workerId: spec.workerId,
    verificationProfile: spec.verificationProfile,
    goal: spec.goal,
    done: spec.done,
    spec,
    maxIterations: spec.maxIterations,
    currentIteration: 1,
    startedAt: new Date().toISOString(),
    worktree: prepared.worktree,
    baseHead: prepared.baseHead,
    iterations: []
  };

  const mutated = { ...spec, maxIterations: 2 };
  await assert.rejects(
    () => runBoundedAutonomy({ sourceRoot: fixture.repo, runRoot: fixture.runRoot, spec: mutated, resumeRecord }, { workerProbe: async () => '1.18.30' }),
    /cannot change the persisted run specification/
  );

  await fs.writeFile(path.join(fixture.repo, 'external.txt'), 'head drift\n');
  await exec('git', ['add', '.'], { cwd: fixture.repo });
  await exec('git', ['commit', '-m', 'head drift'], { cwd: fixture.repo });
  const result = await runBoundedAutonomy({
    sourceRoot: fixture.repo,
    runRoot: fixture.runRoot,
    spec,
    resumeRecord
  }, {
    workerProbe: async () => '1.18.30'
  });
  assert.equal(result.state, 'FAILED');
  assert.match(result.error, /HEAD changed since the interrupted autonomous run/);
});

test('main process and UI expose resume only for persisted INTERRUPTED autonomy', async () => {
  const root = path.resolve(__dirname, '..');
  const main = await fs.readFile(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = await fs.readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const app = await fs.readFile(path.join(root, 'ui', 'app.js'), 'utf8');
  assert.match(main, /record\.state = 'INTERRUPTED'/);
  assert.match(main, /autonomy:resume/);
  assert.match(main, /Only an interrupted autonomous run can resume/);
  assert.match(main, /resumeRecord/);
  assert.match(preload, /resumeAutonomy/);
  assert.match(app, /Resume interrupted run/);
  assert.match(app, /state\.autonomyStatus\?\.state === 'INTERRUPTED'/);
});
