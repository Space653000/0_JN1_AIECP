'use strict';

// A real Control Plane process whose builder never finishes. The parent test kills it with SIGKILL, which is
// what a crash leaves behind: no shutdown, no final persist. Usage: node crash-child.cjs <baseDir>
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../../electron/lib/control-plane.cjs');
const { makeRouter } = require('./e2e-fixtures.cjs');

(async () => {
  const base = process.argv[2];
  const workspace = path.join(base, 'workspace');
  const router = makeRouter({
    onBuilder: async (cwd) => {
      await fs.writeFile(path.join(cwd, 'partial.txt'), 'half done');
      process.stdout.write('BUILDER_STARTED\n');
      await new Promise(() => {});
    }
  });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  const run = await cp.createMission({
    goal: 'Crash mission', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 1,
    maxIterations: 2, maxTurns: 30, maxFailedAttempts: 4, providers: { planner: 'plan', builder: 'build', reviewer: 'review' }
  });
  const task = await cp.enqueueTask(run, { title: 'Survive a crash', objective: 'Do Survive a crash', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });
  process.stdout.write(`IDS ${JSON.stringify({ runId: run.id, taskId: task.id })}\n`);
  await cp.schedulerTick();
  await new Promise(() => {});
})().catch((error) => { process.stderr.write(String(error?.stack || error)); process.exit(1); });
