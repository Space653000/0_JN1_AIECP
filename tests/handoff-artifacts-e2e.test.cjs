'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { validateExecutionContract } = require('../electron/lib/execution-contract.cjs');
const { makeBase, makeRepo, removeDir, waitFor, makeRouter } = require('./support/e2e-fixtures.cjs');

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

test('B03-L168 a real mission hands work over only as schema-versioned artifacts that carry consistent correlation IDs', async (t) => {
  const base = await makeBase('aecp-handoff-');
  t.after(async () => removeDir(base));
  const workspace = await makeRepo(path.join(base, 'workspace'));
  const calls = [];
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({ calls, onBuilder: async (cwd) => fs.writeFile(path.join(cwd, 'artifact-chain.txt'), 'x') }) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  const run = await cp.createMission({ goal: 'Trace the artifact chain', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, maxFailedAttempts: 6, providers: { planner: 'plan', builder: 'build', reviewer: 'review' } });
  const task = await cp.enqueueTask(run, { title: 'Chain', objective: 'Produce an artifact chain', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });
  await cp.schedulerTick();
  await waitFor(() => task.state === 'DONE' && run.state === 'DONE', { timeoutMs: 60000, label: 'the mission' });

  const result = task.result;
  const harnessId = result.id;
  const harnessTask = result.tasks[0];

  // Goal
  for (const contract of [run.executionContract, task.executionContract]) {
    assert.equal(contract.schema, 'aecp.execution-contract/v1');
    assert.equal(validateExecutionContract(contract).ok, true);
  }
  assert.ok(task.executionContract.goal.includes('Trace the artifact chain'));
  assert.deepEqual(task.executionContract.taskIds, [task.id]);
  for (const ref of [task.executionContract.resultCapsuleRef, task.executionContract.evidenceRef, task.executionContract.traceRef]) {
    assert.ok(ref.includes(run.id) && ref.includes(task.id), `${ref} names the mission and the task`);
  }

  // Plan and Task
  const record = await readJson(path.join(result.runRoot, 'harness.json'));
  assert.equal(record.id, harnessId);
  assert.equal(record.plan.schema, 'aecp.plan/v1');
  assert.ok(record.plan.plan_id);
  assert.equal(record.plan.tasks[0].id, harnessTask.id);
  assert.equal(record.executionContract.schema, 'aecp.execution-contract/v1');

  // Context handed to agents
  const knowledge = await readJson(record.repoKnowledge.file);
  assert.equal(knowledge.schema, 'aecp.repo-knowledge/v1');
  const reviewInput = await readJson(harnessTask.reviewInput.file);
  assert.equal(reviewInput.schema, 'aecp.review-input/v1');
  assert.deepEqual([reviewInput.runId, reviewInput.taskId], [harnessId, harnessTask.id]);

  // Worker report, verifier evidence, review
  const workerReport = await readJson(harnessTask.workerReportEvidence.file);
  assert.equal(workerReport.schema, 'aecp.worker-report/v1');
  assert.deepEqual([workerReport.run_id, workerReport.task_id], [harnessId, harnessTask.id]);
  assert.equal(workerReport.completionProof, false, 'a worker report is never proof of completion');
  const verifier = await readJson(workerReport.evidence_refs[0].file);
  assert.equal(verifier.schema, 'aecp.verifier-evidence/v1');
  assert.deepEqual([verifier.run_id, verifier.task_id], [harnessId, harnessTask.id]);
  const review = await readJson(harnessTask.reviewEvidence.file);
  assert.equal(review.schema, 'aecp.review/v1');
  assert.deepEqual([review.run_id, review.task_id], [harnessId, harnessTask.id]);

  // Result
  const capsule = await cp.contextBus.read(task.resultCapsule.id);
  assert.equal(capsule.schema, 'aecp.capsule/v1');
  assert.equal(capsule.kind, 'result');
  assert.deepEqual([capsule.payload.runId, capsule.payload.taskId, capsule.payload.status], [run.id, task.id, 'PASS']);
  const accepted = await readJson(task.acceptedEvidence.file);
  assert.ok(accepted.schema && /\/v\d+$/.test(accepted.schema), 'the accepted-task evidence is versioned');
  const manifest = await readJson(task.evidenceManifest.file);
  assert.equal(manifest.schema, 'aecp.evidence/v1');
  assert.equal(manifest.runId, run.id);
  assert.equal((await cp.evidence.verifyManifest(task.evidenceManifest)).ok, true);

  // The layers are linked: the Control Plane task points at its Harness record, and every journal event carries the mission id
  assert.equal(task.result.id, harnessId);
  await waitFor(async () => (await cp.listEvents(2000)).some((event) => event.type === 'task.finished' && event.taskId === task.id), { label: 'the task.finished journal entry' });
  const events = (await cp.listEvents(2000)).filter((event) => event.taskId === task.id);
  assert.ok(events.length >= 3 && events.every((event) => event.runId === run.id && event.correlationId === run.id));
  for (const artifact of [record.plan, knowledge, reviewInput, workerReport, verifier, review, capsule, manifest]) assert.match(artifact.schema, /^aecp\.[a-z-]+\/v\d+$/);
});

test('B03-L168 providers are invoked statelessly: no adapter passes a resume, session or conversation handle', () => {
  const router = new ProviderRouter();
  const SESSION_FLAG = /^(--?)(resume|continue|session|session-id|conversation|thread|chat-id)$/i;
  let checked = 0;
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    for (const role of provider.roles) {
      const spec = router.commandSpec(id, role, 'PROMPT-TEXT', { model: 'model-1', cwd: path.join(path.sep, 'work'), providerVersion: '1.0.0' });
      checked += 1;
      assert.ok(spec.args.every((arg) => !SESSION_FLAG.test(String(arg))), `${id}/${role}: ${spec.args.join(' ')}`);
      assert.ok(spec.args.filter((arg) => String(arg).includes('PROMPT-TEXT')).length === 1, `${id}/${role}: the task text is a single argument`);
      assert.doesNotMatch(JSON.stringify(spec.env || {}), /session|resume/i);
      if (id === 'claude') assert.ok(!spec.args.includes('-c') && !spec.args.includes('-r'), 'claude is never asked to continue a conversation');
    }
  }
  assert.ok(checked >= 10);
  const codex = router.commandSpec('codex', 'builder', 'PROMPT-TEXT', { model: 'm', cwd: path.join(path.sep, 'work') });
  assert.ok(codex.args.includes('--ephemeral'), 'the Codex Worker keeps no session between tasks');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
