'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const WORKER_REGISTRY_SCHEMA = 'aecp.worker-registry/v1';
const WORKER_STATES = Object.freeze(['IDLE', 'RUNNING', 'CANCELLING', 'FAILED', 'UNKNOWN']);

function now() { return new Date().toISOString(); }

function normalizeWorkerId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('Invalid worker id.');
  return id;
}

function publicWorker(input = {}) {
  return {
    schema: 'aecp.worker/v1',
    id: normalizeWorkerId(input.id),
    name: String(input.name || input.id || '').trim().slice(0, 120),
    providerId: String(input.providerId || '').trim().slice(0, 120),
    providerName: String(input.providerName || input.providerId || '').trim().slice(0, 120),
    model: input.model ? String(input.model).trim().slice(0, 200) : null,
    role: String(input.role || 'builder').trim().slice(0, 40),
    runtime: String(input.runtime || '').trim().slice(0, 120),
    codexHome: input.codexHome ? path.resolve(String(input.codexHome)) : null,
    runtimeState: WORKER_STATES.includes(input.runtimeState) ? input.runtimeState : 'IDLE',
    processId: Number.isInteger(input.processId) && input.processId > 0 ? input.processId : null,
    runId: input.runId ? String(input.runId) : null,
    taskId: input.taskId ? String(input.taskId) : null,
    repository: input.repository ? path.resolve(String(input.repository)) : null,
    worktree: input.worktree ? path.resolve(String(input.worktree)) : null,
    verificationState: input.verificationState ? String(input.verificationState).slice(0, 80) : null,
    startedAt: input.startedAt || null,
    heartbeatAt: input.heartbeatAt || null,
    timeoutAt: input.timeoutAt || null,
    cancelState: input.cancelState ? String(input.cancelState).slice(0, 80) : null,
    lastResultState: input.lastResultState ? String(input.lastResultState).slice(0, 80) : null,
    lastFinishedAt: input.lastFinishedAt || null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String).slice(0, 100) : [],
    updatedAt: input.updatedAt || now()
  };
}

class WorkerRegistry {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.file = path.join(this.rootDir, 'worker-registry.json');
    this.state = { schema: WORKER_REGISTRY_SCHEMA, workers: {}, updatedAt: now() };
    this.persistQueue = Promise.resolve();
    this.sequence = 0;
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (parsed?.schema !== WORKER_REGISTRY_SCHEMA || !parsed?.workers || typeof parsed.workers !== 'object') {
        throw new Error('Unsupported Worker Registry schema.');
      }
      this.state = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
    let changed = false;
    for (const worker of Object.values(this.state.workers)) {
      if (['RUNNING', 'CANCELLING'].includes(worker.runtimeState)) {
        worker.runtimeState = 'UNKNOWN';
        worker.processId = null;
        worker.cancelState = 'RECOVERY_REQUIRED';
        worker.updatedAt = now();
        changed = true;
      }
    }
    if (changed) await this.persist();
    return this.list();
  }

  async persist() {
    this.state.updatedAt = now();
    const payload = JSON.stringify(this.state, null, 2) + '\n';
    const tmp = this.file + '.tmp-' + process.pid + '-' + (++this.sequence);
    const write = async () => {
      await fs.mkdir(this.rootDir, { recursive: true });
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, this.file);
    };
    const operation = this.persistQueue.then(write, write);
    this.persistQueue = operation.catch(() => {});
    return operation;
  }

  list() {
    return Object.values(this.state.workers).map(publicWorker);
  }

  get(workerId) {
    const worker = this.state.workers[normalizeWorkerId(workerId)];
    return worker ? publicWorker(worker) : null;
  }

  async register(profile) {
    const worker = publicWorker(profile);
    if (!worker.providerId) throw new Error('Worker providerId is required.');
    if (!worker.runtime) throw new Error('Worker runtime is required.');
    if (!worker.codexHome) throw new Error('Worker CODEX_HOME is required.');

    const canonicalHome = process.platform === 'win32' ? worker.codexHome.toLowerCase() : worker.codexHome;
    for (const existing of Object.values(this.state.workers)) {
      if (existing.id === worker.id || !existing.codexHome) continue;
      const existingHome = process.platform === 'win32'
        ? path.resolve(existing.codexHome).toLowerCase()
        : path.resolve(existing.codexHome);
      if (existingHome === canonicalHome) throw new Error('Workers must not share CODEX_HOME.');
    }

    const current = this.state.workers[worker.id];
    if (current && ['RUNNING', 'CANCELLING'].includes(current.runtimeState)) {
      const immutableChanged = current.providerId !== worker.providerId ||
        current.runtime !== worker.runtime ||
        path.resolve(current.codexHome) !== worker.codexHome;
      if (immutableChanged) throw new Error('Cannot replace an active worker runtime profile.');
    }

    this.state.workers[worker.id] = {
      ...worker,
      runtimeState: current?.runtimeState || worker.runtimeState || 'IDLE',
      processId: current?.processId || null,
      runId: current?.runId || null,
      taskId: current?.taskId || null,
      repository: current?.repository || null,
      worktree: current?.worktree || null,
      verificationState: current?.verificationState || null,
      startedAt: current?.startedAt || null,
      heartbeatAt: current?.heartbeatAt || null,
      timeoutAt: current?.timeoutAt || null,
      cancelState: current?.cancelState || null,
      lastResultState: current?.lastResultState || null,
      lastFinishedAt: current?.lastFinishedAt || null,
      evidenceRefs: current?.evidenceRefs || []
    };
    await this.persist();
    return this.get(worker.id);
  }

  available(workerIds) {
    const allowed = new Set((workerIds || []).map(normalizeWorkerId));
    return this.list()
      .filter(worker => (!allowed.size || allowed.has(worker.id)) && worker.runtimeState === 'IDLE')
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  selectAvailable(workerIds) {
    return this.available(workerIds)[0] || null;
  }

  async acquire(workerId, assignment = {}) {
    const id = normalizeWorkerId(workerId);
    const worker = this.state.workers[id];
    if (!worker) throw new Error('Worker is not registered.');
    if (worker.runtimeState !== 'IDLE') {
      throw Object.assign(new Error('Worker is busy.'), { code: 'WORKER_BUSY', workerId: id });
    }
    worker.runtimeState = 'RUNNING';
    worker.runId = assignment.runId ? String(assignment.runId) : null;
    worker.taskId = assignment.taskId ? String(assignment.taskId) : null;
    worker.repository = assignment.repository ? path.resolve(String(assignment.repository)) : null;
    worker.worktree = assignment.worktree ? path.resolve(String(assignment.worktree)) : null;
    worker.processId = Number.isInteger(assignment.processId) && assignment.processId > 0 ? assignment.processId : null;
    worker.verificationState = assignment.verificationState ? String(assignment.verificationState) : 'PENDING';
    worker.startedAt = now();
    worker.heartbeatAt = worker.startedAt;
    worker.timeoutAt = assignment.timeoutAt || null;
    worker.cancelState = null;
    worker.updatedAt = now();
    await this.persist();
    return this.get(id);
  }

  async updateAssignment(workerId, patch = {}) {
    const id = normalizeWorkerId(workerId);
    const worker = this.state.workers[id];
    if (!worker) throw new Error('Worker is not registered.');
    if (!['RUNNING', 'CANCELLING'].includes(worker.runtimeState)) throw new Error('Worker is not active.');
    for (const key of ['runId', 'taskId', 'verificationState', 'timeoutAt', 'cancelState']) {
      if (patch[key] !== undefined) worker[key] = patch[key] == null ? null : String(patch[key]);
    }
    for (const key of ['repository', 'worktree']) {
      if (patch[key] !== undefined) worker[key] = patch[key] == null ? null : path.resolve(String(patch[key]));
    }
    if (patch.processId !== undefined) worker.processId = Number.isInteger(patch.processId) && patch.processId > 0 ? patch.processId : null;
    if (Array.isArray(patch.evidenceRefs)) worker.evidenceRefs = patch.evidenceRefs.map(String).slice(0, 100);
    worker.heartbeatAt = now();
    worker.updatedAt = now();
    await this.persist();
    return this.get(id);
  }

  async markCancelling(workerId) {
    const id = normalizeWorkerId(workerId);
    const worker = this.state.workers[id];
    if (!worker) throw new Error('Worker is not registered.');
    if (worker.runtimeState === 'IDLE') return this.get(id);
    worker.runtimeState = 'CANCELLING';
    worker.cancelState = 'REQUESTED';
    worker.updatedAt = now();
    await this.persist();
    return this.get(id);
  }

  async release(workerId, { resultState = null, verificationState = null, evidenceRefs = null } = {}) {
    const id = normalizeWorkerId(workerId);
    const worker = this.state.workers[id];
    if (!worker) throw new Error('Worker is not registered.');
    worker.lastResultState = resultState ? String(resultState) : worker.lastResultState || null;
    worker.verificationState = verificationState ? String(verificationState) : worker.verificationState || null;
    if (Array.isArray(evidenceRefs)) worker.evidenceRefs = evidenceRefs.map(String).slice(0, 100);
    worker.lastFinishedAt = now();
    worker.runtimeState = 'IDLE';
    worker.processId = null;
    worker.runId = null;
    worker.taskId = null;
    worker.repository = null;
    worker.worktree = null;
    worker.startedAt = null;
    worker.heartbeatAt = null;
    worker.timeoutAt = null;
    worker.cancelState = null;
    worker.updatedAt = now();
    await this.persist();
    return this.get(id);
  }

  async fail(workerId, reason = 'FAILED') {
    const id = normalizeWorkerId(workerId);
    const worker = this.state.workers[id];
    if (!worker) throw new Error('Worker is not registered.');
    worker.runtimeState = 'FAILED';
    worker.lastResultState = String(reason).slice(0, 120);
    worker.lastFinishedAt = now();
    worker.processId = null;
    worker.updatedAt = now();
    await this.persist();
    return this.get(id);
  }
}

module.exports = {
  WORKER_REGISTRY_SCHEMA,
  WORKER_STATES,
  WorkerRegistry,
  normalizeWorkerId,
  publicWorker
};
