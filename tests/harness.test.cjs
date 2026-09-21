'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeJson, normalizePlan, STATES, cli, invokeRole } = require('../electron/lib/harness.cjs');

test('Harness exposes bounded state machine states', () => {
  assert.ok(STATES.includes('PLANNING'));
  assert.ok(STATES.includes('REVIEWING'));
  assert.ok(STATES.includes('HUMAN_REQUIRED'));
  assert.ok(STATES.includes('DONE'));
});

test('Planner JSON parser accepts fenced JSON', () => {
  const value = safeJson('```json\n{"tasks":[{"task_id":"T1","objective":"add test"}]}\n```');
  assert.equal(value.tasks[0].task_id, 'T1');
});

test('Planner output is normalized and bounded', () => {
  const plan = normalizePlan({
    tasks: [
      { task_id: 'T1', title: 'One', objective: 'Implement one', dependencies: [], risk: 'GREEN' },
      { task_id: 'T2', title: 'Two', objective: 'Implement two', dependencies: ['T1'], risk: 'YELLOW' }
    ]
  }, 'goal', 'done', 2);
  assert.equal(plan.schema, 'aecp.plan/v1');
  assert.equal(plan.tasks.length, 2);
  assert.deepEqual(plan.tasks[1].dependencies, ['T1']);
});

test('Provider Router-backed Harness role selection is explicit and vendor-neutral', () => {
  const calls = [];
  const router = {
    commandSpec(provider, role, prompt, options) {
      calls.push({ provider, role, prompt, options });
      return { command: 'worker', args: [prompt], provider, model: options.model || null, cwd: options.cwd };
    }
  };
  const spec = cli('builder', 'build safely', 'C:\\repo', 'local-model', 'local-agent', router);
  assert.equal(spec.provider, 'local-agent');
  assert.equal(spec.command, 'worker');
  assert.equal(calls[0].role, 'builder');
  assert.equal(calls[0].options.model, 'local-model');
});

test('safeJson unwraps provider CLI result envelopes', () => {
  const value = safeJson(JSON.stringify({ type: 'result', result: '{"result":"PASS","findings":[],"required_changes":[]}' }));
  assert.equal(value.result, 'PASS');
});

test('direct network providers cannot run without NETWORK and CREDENTIAL approval', async () => {
  const actions = [];
  const policy = { assert(input) { actions.push(input); if (!input.approved) throw Object.assign(new Error('approval required'), { code: 'APPROVAL_REQUIRED' }); } };
  const router = {
    capabilities() { return { process: false, network: true, credential: true }; },
    async execute() { return { code: 0, stdout: '{}', stderr: '' }; }
  };
  await assert.rejects(() => invokeRole({ router, role: 'planner', prompt: 'plan', cwd: 'C:\\repo', providerId: 'corp-api', policy }), /approval required/);
  const result = await invokeRole({ router, role: 'planner', prompt: 'plan', cwd: 'C:\\repo', providerId: 'corp-api', policy, networkApproved: true, credentialApproved: true });
  assert.equal(result.code, 0);
  assert.ok(actions.some(x => x.action === 'NETWORK' && x.approved));
  assert.ok(actions.some(x => x.action === 'CREDENTIAL' && x.approved));
});
