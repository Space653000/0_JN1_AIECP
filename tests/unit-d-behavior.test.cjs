'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { validateAutonomySpec, runProcess, runBoundedAutonomy, applyVerifiedPatch, buildWorkerInvocation, openCodeV1Config } = require('../electron/lib/autonomy.cjs');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=AECP Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' }).toString();
const GOAL = { goal: 'Create a large file.', done: 'The verifier passes.', workerId: 'opencode', verificationProfile: 'npm-test' };

test('B07-L44 the detected repositories report their real branch and their real dirty/clean state', async (t) => {
  const ctx = loadMain();
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-branch-')));
  t.after(() => { fs.rmSync(base, { recursive: true, force: true }); ctx.dispose(); });
  const clean = path.join(base, 'clean-repo');
  const dirty = path.join(base, 'dirty-repo');
  for (const [dir, branch] of [[clean, 'release-line'], [dirty, 'feature-x']]) {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    git(dir, 'checkout', '-q', '-b', branch);
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'base');
  }
  fs.writeFileSync(path.join(dirty, 'untracked.txt'), 'not committed');
  await ctx.start();
  ctx.control.chosenFolder = base;
  const byName = (workspace) => Object.fromEntries(workspace.repositories.map((repo) => [repo.name, repo]));
  const first = byName(await ctx.handlers['workspace:select']({}));
  assert.equal(first['clean-repo'].branch, 'release-line');
  assert.equal(first['clean-repo'].dirty, false);
  assert.equal(first['dirty-repo'].branch, 'feature-x');
  assert.equal(first['dirty-repo'].dirty, true);
  git(clean, 'checkout', '-q', '-b', 'another-branch');
  fs.writeFileSync(path.join(clean, 'README.md'), 'edited');
  fs.rmSync(path.join(dirty, 'untracked.txt'));
  await ctx.handlers['workspace:refresh']({});
  const after = byName((await ctx.handlers['state:get']({})).currentWorkspace);
  assert.equal(after['clean-repo'].branch, 'another-branch', 'a branch switch is reported');
  assert.equal(after['clean-repo'].dirty, true, 'an edit to a tracked file makes it dirty');
  assert.equal(after['dirty-repo'].dirty, false, 'removing the stray file makes it clean again');
});

test('B08-L89 the numeric limits of Local Autonomous mode are clamped by AECP, not chosen by the model or the caller', () => {
  const big = validateAutonomySpec({ ...GOAL, maxIterations: 999, iterationTimeoutSeconds: 999999, checkpointEvery: 99, maxPatchBytes: 2 ** 40, maxChangedFiles: 999999, maxOutputBytes: 2 ** 40 });
  assert.equal(big.maxIterations, 12);
  assert.equal(big.maxTurns, 12, 'turns follow the iteration cap');
  assert.equal(big.iterationTimeoutSeconds, 1800);
  assert.equal(big.checkpointEvery, 6);
  assert.equal(big.maxPatchBytes, 8 * 1024 * 1024);
  assert.equal(big.maxChangedFiles, 1000);
  assert.equal(big.maxOutputBytes, 1024 * 1024, 'the output bound cannot be raised through the input');
  const small = validateAutonomySpec({ ...GOAL, maxIterations: 0, iterationTimeoutSeconds: 1, maxPatchBytes: 1, maxChangedFiles: 0 });
  assert.equal(small.maxIterations, 1);
  assert.equal(small.iterationTimeoutSeconds, 30);
  assert.equal(small.maxPatchBytes, 1024);
  assert.equal(small.maxChangedFiles, 1);
});

test('B08-L89 a worker process that runs too long or prints too much is killed by the runner', async () => {
  const slow = await runProcess('node', ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 1000 });
  assert.equal(slow.timedOut, true, 'the time limit is enforced outside the process');
  const loud = await runProcess('node', ['-e', "process.stdout.write('x'.repeat(100000)); setTimeout(() => {}, 5000)"], { timeoutMs: 20000, maxOutputBytes: 1000 });
  assert.equal(loud.outputLimitExceeded, true, 'the output limit is enforced outside the process');
  assert.ok(loud.stdout.length <= 1000);
});

test('B08-L89 a patch larger than the patch budget ends the run as BUDGET_EXHAUSTED and nothing is applied', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-patchbudget-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'value.txt'), 'original\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const record = await runBoundedAutonomy({ sourceRoot: repo, runRoot: path.join(root, 'run'), spec: { ...GOAL, maxIterations: 1, maxPatchBytes: 1024 } }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      fs.writeFileSync(path.join(options.cwd, 'big.txt'), 'y'.repeat(5000));
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'changed', stderr: '' };
    },
    runVerification: async () => ({ profile: 'npm-test', label: 'fake', command: 'fake', passed: true, code: 0, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'PASS', stderr: '' })
  });
  assert.equal(record.state, 'BUDGET_EXHAUSTED');
  assert.match(record.error, /Patch budget exceeded/);
  assert.equal(fs.existsSync(path.join(repo, 'big.txt')), false, 'the source repository is untouched');
});

test('B08-L89 the permission limit is a deny-first policy handed to the worker, not a request in the prompt', () => {
  const invocation = buildWorkerInvocation('opencode', { prompt: 'Do work', cwd: process.cwd(), versionText: '1.18.30' });
  const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config, openCodeV1Config());
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.bash['*'], 'deny');
  const codex = buildWorkerInvocation('codex-cli', { prompt: 'Do work', cwd: process.cwd() });
  assert.ok(codex.args.includes('workspace-write'));
  assert.ok(codex.args.includes('sandbox_workspace_write.network_access=false'));
});


test('B08-L79 the Local Autonomous Loop adapter edits an isolated worktree, and only an explicit apply on an unchanged HEAD touches the repository', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-loopadapter-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const value = () => fs.readFileSync(path.join(repo, 'value.txt'), 'utf8').trim();
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'value.txt'), 'original');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  let counter = 0;
  const run = () => runBoundedAutonomy({ sourceRoot: repo, runRoot: path.join(root, `run-${++counter}`), spec: { ...GOAL, maxIterations: 1 } }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (_command, _args, options) => {
      fs.writeFileSync(path.join(options.cwd, 'value.txt'), 'changed by the worker');
      return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'changed', stderr: '' };
    },
    runVerification: async () => ({ profile: 'npm-test', label: 'fake', command: 'fake', passed: true, code: 0, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'PASS', stderr: '' })
  });
  const record = await run();
  assert.equal(record.state, 'DONE');
  assert.notEqual(path.resolve(record.worktree), path.resolve(repo), 'the worker worked somewhere else');
  assert.equal(value(), 'original', 'a verified run alone changes nothing in the repository');
  const applied = await applyVerifiedPatch({ sourceRoot: repo, runRecord: record });
  assert.equal(applied.applied, true);
  assert.equal(value(), 'changed by the worker');
  git(repo, 'checkout', '-q', '--', '.');
  const stale = await run();
  fs.writeFileSync(path.join(repo, 'other.txt'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'HEAD moves');
  await assert.rejects(() => applyVerifiedPatch({ sourceRoot: repo, runRecord: stale }), /HEAD changed/);
  assert.equal(value(), 'original', 'a stale patch is refused');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
