'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const ok = (stdout) => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false });

async function git(cwd, ...args) {
  return (await exec('git', args, { cwd })).stdout.trim();
}

async function makeBase(prefix = 'aecp-e2e-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function makeRepo(dir, { verify = 'node -e "process.exit(0)"', name = 'e2e-repo' } = {}) {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'AECP Test');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true, scripts: { verify } }));
  await fs.writeFile(path.join(dir, 'README.md'), 'baseline\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

async function waitFor(check, { timeoutMs = 40000, everyMs = 100, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

function reviewJson({ runId, taskId, provider, result = 'PASS', findings = [], requiredChanges = [] }) {
  return JSON.stringify({
    schema: 'aecp.review/v1', task_id: taskId, run_id: runId, reviewer: { provider, model: 'UNKNOWN' }, result,
    blueprint: 'PASS', plan: 'PASS', implementation: 'PASS', tests: 'PASS', security: 'PASS', architecture: 'PASS',
    findings, required_changes: requiredChanges
  });
}

function reviewIds(prompt) {
  return {
    runId: prompt.match(/"run_id":"([^"]+)"/)?.[1],
    taskId: prompt.match(/"task_id":"([^"]+)"/)?.[1],
    provider: prompt.match(/"provider":"([^"]+)"/)?.[1]
  };
}

// A provider router that behaves like real providers at the boundary: it only sees a role, a prompt and options.
function makeRouter({ missionTasks = [], onBuilder = null, onReviewer = null, caps = {}, calls = [] } = {}) {
  const ids = { planner: 'plan', builder: 'build', reviewer: 'review' };
  let builderCount = 0;
  let reviewerCount = 0;
  return {
    calls,
    resolve: (role, provider) => (ids[role] === provider ? { id: provider } : null),
    capabilities: (role) => ({ process: false, network: false, credential: false, discoversAgentsMd: false, ...(caps[role] || {}) }),
    health: async (provider) => ({ provider, status: 'READY' }),
    async execute(role, prompt, opts) {
      const entry = { role, kind: role, prompt, cwd: opts?.cwd };
      calls.push(entry);
      if (role === 'planner' && prompt.startsWith('You are the AECP Mission Planner')) {
        entry.kind = 'mission-planner';
        return ok(JSON.stringify({ tasks: missionTasks }));
      }
      if (role === 'planner') {
        entry.title = prompt.match(/Task: ([^\n]+)/)?.[1] || 'Task';
        const objective = prompt.match(/OBJECTIVE: ([^\n]+)/)?.[1] || 'Make the change.';
        return ok(JSON.stringify({ tasks: [{ task_id: 'T1', title: entry.title, objective, acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] }));
      }
      if (role === 'builder') {
        builderCount += 1;
        entry.title = prompt.match(/Task: ([^\n]+)/)?.[1] || 'Task';
        entry.objective = prompt.match(/"objective": "([^"]+)"/)?.[1] || '';
        entry.index = builderCount;
        if (onBuilder) await onBuilder(opts.cwd, { ...entry, opts });
        else await fs.writeFile(path.join(opts.cwd, 'worker-output.txt'), 'made by the worker\n');
        return ok('builder done');
      }
      reviewerCount += 1;
      entry.index = reviewerCount;
      const ids2 = reviewIds(prompt);
      const override = onReviewer ? await onReviewer({ ...ids2, index: reviewerCount, prompt }) : null;
      return ok(reviewJson({ ...ids2, ...(override || {}) }));
    }
  };
}

// Late writes from just-aborted runs can race the removal, so wait briefly and retry.
async function removeDir(dir) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

const TASK_TERMINAL = ['DONE', 'BLOCKED', 'FAILED', 'HUMAN_REQUIRED', 'BUDGET_EXHAUSTED', 'CANCELLED'];

module.exports = { ok, git, makeBase, makeRepo, removeDir, waitFor, reviewJson, reviewIds, makeRouter, TASK_TERMINAL, exec };
