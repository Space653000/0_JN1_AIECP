'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const {
  validateAutonomySpec,
  buildWorkerInvocation,
  buildIterationPrompt,
  openCodeV1Config,
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
  assert.equal(await fs.readFile(path.join(repo, 'value.txt'), 'utf8'), 'original\n');
  assert.equal(await fs.readFile(path.join(record.worktree, 'value.txt'), 'utf8'), 'changed\n');

  const applied = await applyVerifiedPatch({ sourceRoot: repo, runRecord: record });
  assert.equal(applied.applied, true);
  assert.equal(await fs.readFile(path.join(repo, 'value.txt'), 'utf8'), 'changed\n');
});
