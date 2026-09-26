'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubGateway } = require('../electron/lib/github-gateway.cjs');

function gateway() {
  const calls = [];
  const run = async (tool, args, options = {}) => {
    calls.push({ tool, args, cwd: options.cwd });
    if (tool === 'git' && args[0] === 'rev-parse') return 'abc123';
    return 'ok';
  };
  return { calls, gw: new GitHubGateway({ repo: 'example/repo', cwd: '/work/tree', run }) };
}

test('B05-L34 local repository steps use git and only the GitHub API steps use gh', async () => {
  const { calls, gw } = gateway();
  assert.equal(await gw.currentSha(), 'abc123');
  await gw.commitAll('message');
  await gw.push('feature/x');
  await gw.createBranch('feature/x');
  const gh = calls.filter((call) => call.tool === 'gh').map((call) => call.args[0]);
  const gitCalls = calls.filter((call) => call.tool === 'git').map((call) => call.args[0]);
  assert.deepEqual(gitCalls.filter((verb, index, all) => all.indexOf(verb) === index).sort(), ['add', 'commit', 'push', 'rev-parse']);
  assert.deepEqual(gh, ['api'], 'gh has no rev-parse, add, commit or push subcommands');
  for (const call of calls) assert.equal(call.cwd, '/work/tree', 'every command runs in the task worktree');
});

test('B05-L34 the push never forces and never targets anything but the named branch on origin', async () => {
  const { calls, gw } = gateway();
  await gw.push('feature/x');
  const push = calls.find((call) => call.args[0] === 'push');
  assert.deepEqual(push.args, ['push', '-u', 'origin', 'feature/x']);
});

test('B05-L34 pull requests are always drafts unless a caller explicitly opts out, and merging is not a capability of the gateway', async () => {
  const { calls, gw } = gateway();
  await gw.createPR({ branch: 'feature/x', title: 'T', body: 'B' });
  const create = calls.find((call) => call.args[0] === 'pr' && call.args[1] === 'create');
  assert.ok(create.args.includes('--draft'));
  assert.equal(typeof gw.mergePR, 'undefined', 'no merge capability');
  assert.ok(!calls.some((call) => call.args.includes('merge')));
});
