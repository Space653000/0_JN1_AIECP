'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { runHarness } = require('./lib/harness.cjs');
const { ControlPlane } = require('./lib/control-plane.cjs');
const { ProviderRouter, PROVIDERS } = require('./lib/provider-router.cjs');
const { SecurityPolicy } = require('./lib/security-policy.cjs');
const { migrateState } = require('./lib/state-migration.cjs');
const { recommendNextAction } = require('./lib/guidance.cjs');
const { WindowsDesktopAdapter } = require('./lib/windows-desktop-adapter.cjs');
const { writeBackup, stageRestore, applyPendingRestore } = require('./lib/backup-manager.cjs');
const { WindowsUiAdapter } = require('./lib/windows-ui-adapter.cjs');
const { PythonWorker } = require('./lib/python-worker.cjs');

const { parseCommandCard, makeTaskId, makeResultCapsule, hashJson } = require('./lib/protocol.cjs');
const { compareVersions, versionFromTag, selectHighestRelease, selectInstallerAsset } = require('./lib/version.cjs');
const { createUpdateTransaction, transitionUpdate, reconcileFirstBoot } = require('./lib/update-state.cjs');
const {
  AUTONOMOUS_WORKERS,
  VERIFICATION_PROFILES,
  validateAutonomySpec,
  makeRunId,
  runBoundedAutonomy,
  applyVerifiedPatch,
  samePhysicalPath
} = require('./lib/autonomy.cjs');

const STATE_SCHEMA = 1;
const UPDATE_REPO = 'Space653000/AI-Engineering-Control-Plane';
const AGENT_SPECS = Object.freeze([
  { id: 'codex-cli', name: 'Codex CLI', command: 'codex', args: ['--version'], role: 'coding' },
  { id: 'claude-code', name: 'Claude Code', command: 'claude', args: ['--version'], role: 'coding' },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', args: ['--version'], role: 'research-coding' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['--version'], role: 'local-agent' },
  { id: 'ollama', name: 'Local Ollama', command: 'ollama', args: ['--version'], role: 'local-models' }
]);
let mainWindow = null;
let mcpRuntime = null;
let autonomyController = null;
let autonomyRecord = null;
let harnessController = null;
let harnessRecord = null;
let controlPlane = null;
const desktopAdapter = new WindowsDesktopAdapter();
const windowsUiAdapter = new WindowsUiAdapter();
const pythonWorker = new PythonWorker();

function dataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

async function ensureDataDirs() {
  await fsp.mkdir(dataPath(), { recursive: true });
  await fsp.mkdir(dataPath('evidence'), { recursive: true });
}

function defaultState() {
  return {
    schemaVersion: STATE_SCHEMA,
    currentWorkspaceId: null,
    workspaces: [],
    tasks: [],
    providers: []
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(temp, file);
}

async function loadState() {
  const raw = await readJson(dataPath('state.json'), defaultState());
  const migration = migrateState(raw, STATE_SCHEMA);
  const state = migration.state;
  if (migration.mode === 'READ_ONLY_RECOVERY') {
    Object.defineProperty(state, '__aecpReadOnlyRecovery', { value: true, enumerable: false });
    state.recovery = {
      mode: migration.mode,
      sourceVersion: migration.sourceVersion,
      supportedVersion: migration.targetVersion,
      reason: migration.reason
    };
    return state;
  }
  if (migration.migrated) await writeJsonAtomic(dataPath('state.json'), state);
  return state;
}

async function saveState(state) {
  if (state?.__aecpReadOnlyRecovery || state?.recovery?.mode === 'READ_ONLY_RECOVERY') {
    throw new Error('AECP local state is in read-only recovery mode because it was created by a newer schema.');
  }
  await writeJsonAtomic(dataPath('state.json'), state);
}

function getCurrentWorkspace(state) {
  return state.workspaces.find((item) => item.id === state.currentWorkspaceId) || null;
}

function workspaceId(root) {
  return `ws-${crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 12)}`;
}

async function realDirectory(input) {
  const resolved = path.resolve(input);
  const real = await fsp.realpath(resolved).catch(() => resolved);
  const stat = await fsp.stat(real);
  if (!stat.isDirectory()) throw new Error('Workspace must be a directory.');
  return real;
}

function execFixed(command, args, cwd, timeout = 7000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = String(stdout || '');
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}

async function probe(command, args) {
  try {
    const result = await execFixed(command, args, undefined, 4500);
    const line = (result.stdout || result.stderr || 'Detected').split(/\r?\n/)[0].slice(0, 160);
    return { id: command, available: true, version: line };
  } catch (error) {
    const line = String(error.stdout || error.stderr || '').split(/\r?\n/)[0].slice(0, 160);
    return { id: command, available: false, version: line || 'Not found' };
  }
}

async function detectTools() {
  const tools = await Promise.all([
    probe('git', ['--version']),
    probe('pwsh', ['--version']),
    probe('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
    probe('python', ['--version']),
    probe('node', ['--version']),
    probe('gh', ['--version']),
    probe('ollama', ['--version'])
  ]);
  const names = { git: 'Git', pwsh: 'PowerShell 7', powershell: 'Windows PowerShell', python: 'Python', node: 'Node.js', gh: 'GitHub CLI', ollama: 'Ollama' };
  return tools.map((tool) => ({ ...tool, name: names[tool.id] || tool.id }));
}

async function detectAgents() {
  const agents = [{
    id: 'chatgpt-web',
    name: 'ChatGPT Web',
    role: 'supervisor',
    available: true,
    version: 'Official web',
    kind: 'web'
  }];
  for (const spec of AGENT_SPECS) {
    const status = await probe(spec.command, spec.args);
    agents.push({
      id: spec.id,
      name: spec.name,
      role: spec.role,
      available: status.available,
      version: status.version,
      kind: spec.id === 'ollama' ? 'local' : 'cli'
    });
  }
  return agents;
}

async function preferredPowerShell() {
  return (await probe('pwsh', ['--version'])).available ? 'pwsh' : 'powershell';
}

async function launchAgent(agentId) {
  if (agentId === 'chatgpt-web') {
    await shell.openExternal('https://chatgpt.com/');
    return { ok: true, id: agentId };
  }
  const spec = AGENT_SPECS.find((item) => item.id === agentId);
  if (!spec) throw new Error('Unsupported agent.');
  const status = await probe(spec.command, spec.args);
  if (!status.available) throw new Error(`${spec.name} is not installed or not on PATH.`);
  const state = await loadState();
  const workspace = getCurrentWorkspace(state);
  if (!workspace) throw new Error('Choose a Workspace first.');
  const safePath = workspace.rootPath.replace(/'/g, "''");
  const terminal = await preferredPowerShell();
  const action = agentId === 'ollama' ? 'ollama list' : `& ${spec.command}`;
  const child = spawn(terminal, ['-NoExit', '-Command', `Set-Location -LiteralPath '${safePath}'; ${action}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return { ok: true, id: agentId };
}

async function buildRemoteGatewayOptions() {
  const host = String(process.env.AECP_REMOTE_HOST || '127.0.0.1').trim();
  const allowRemote = process.env.AECP_REMOTE_ALLOW === '1';
  const port = Number(process.env.AECP_REMOTE_PORT || 0);
  const keyPath = String(process.env.AECP_REMOTE_TLS_KEY || '').trim();
  const certPath = String(process.env.AECP_REMOTE_TLS_CERT || '').trim();
  if (Boolean(keyPath) !== Boolean(certPath)) throw new Error('AECP remote TLS requires both AECP_REMOTE_TLS_KEY and AECP_REMOTE_TLS_CERT.');
  let tls = null;
  if (keyPath && certPath) {
    tls = { key: await fsp.readFile(keyPath), cert: await fsp.readFile(certPath), minVersion: 'TLSv1.2' };
  }
  return { host, allowRemote, port: Number.isFinite(port) && port >= 0 ? port : 0, tls };
}

async function initControlPlane() {
  if (controlPlane) return controlPlane;
  controlPlane = new ControlPlane({
    rootDir: dataPath('runtime'),
    providerRouter: await buildRuntimeProviderRouter(),
    remoteOptions: await buildRemoteGatewayOptions(),
    emit: async (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('control-plane:event', event);
    }
  });
  await controlPlane.init();
  controlPlane.schedule();
  return controlPlane;
}

async function startHarness(payload) {
  if (harnessController) throw new Error('A Harness run is already active.');
  const state = await loadState();
  const workspace = getCurrentWorkspace(state);
  if (!workspace) throw new Error('Choose a Workspace first.');
  const controller = new AbortController();
  harnessController = controller;
  const runRoot = dataPath('harness', 'runs', `run-${Date.now()}`);
  const initial = { schema: 'aecp.harness/v1', state: 'PLANNING', runRoot, goal: payload?.goal || '', done: payload?.done || '', startedAt: new Date().toISOString() };
  harnessRecord = initial;
  const providerRouter = await buildRuntimeProviderRouter();
  const policy = new SecurityPolicy({ allowRoots: [workspace.rootPath, runRoot] });
  void runHarness({
    ...payload, sourceRoot: workspace.rootPath, runRoot, signal: controller.signal,
    providerRouter, policy,
    onEvent: async (event) => {
      harnessRecord = { ...harnessRecord, state: event.state, events: [...(harnessRecord.events || []), event] };
      sendAutonomyEvent({ schema: 'aecp.harness.event/v1', ...event });
    }
  }).then((record) => {
    harnessRecord = record;
    sendAutonomyEvent({ schema: 'aecp.harness.event/v1', runId: record.id, type: 'harness.final', state: record.state, data: { patch: record.patch || null } });
  }).catch((error) => {
    harnessRecord = { ...harnessRecord, state: 'FAILED', error: String(error?.message || error) };
  }).finally(() => { harnessController = null; });
  return initial;
}
async function harnessStatus() { return harnessRecord; }
async function cancelHarness() {
  if (harnessController) harnessController.abort();
  return harnessRecord;
}

async function latestAutonomyRecord() {
  if (autonomyRecord) return autonomyRecord;
  const root = dataPath('autonomy', 'runs');
  let entries = [];
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return null; }
  const dirs = entries.filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse();
  for (const name of dirs) {
    const record = await readJson(path.join(root, name, 'run.json'), null);
    if (record) {
      if (['PREPARING', 'RUNNING', 'VERIFYING'].includes(record.state) && !autonomyController) {
        record.state = 'INTERRUPTED';
      }
      autonomyRecord = record;
      return record;
    }
  }
  return null;
}

async function autonomyOptions() {
  const workers = [];
  for (const worker of Object.values(AUTONOMOUS_WORKERS)) {
    const status = await probe(worker.command, ['--version']);
    workers.push({
      ...worker,
      available: status.available,
      version: status.version
    });
  }

  let recommendedVerification = 'npm-test';
  const state = await loadState();
  const workspace = getCurrentWorkspace(state);
  if (workspace) {
    try {
      const pkg = JSON.parse(await fsp.readFile(path.join(workspace.rootPath, 'package.json'), 'utf8'));
      if (pkg?.scripts?.verify) recommendedVerification = 'npm-verify';
      else if (pkg?.scripts?.test) recommendedVerification = 'npm-test';
    } catch {
      try {
        await fsp.access(path.join(workspace.rootPath, 'pytest.ini'));
        recommendedVerification = 'pytest';
      } catch {
        try {
          await fsp.access(path.join(workspace.rootPath, 'pyproject.toml'));
          recommendedVerification = 'pytest';
        } catch {}
      }
    }
  }

  const recommendedWorker = workers.find((item) => item.id === 'opencode' && item.available)?.id
    || workers.find((item) => item.id === 'codex-cli' && item.available)?.id
    || null;

  return {
    workers,
    recommendedWorker,
    recommendedVerification,
    verificationProfiles: Object.values(VERIFICATION_PROFILES).map((item) => ({
      id: item.id,
      label: item.label
    }))
  };
}

function sendAutonomyEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('autonomy:event', event);
}

async function startAutonomy(payload) {
  if (autonomyController) throw new Error('An autonomous run is already active.');
  const state = await loadState();
  const workspace = getCurrentWorkspace(state);
  if (!workspace) throw new Error('Choose a Workspace first.');

  let rootRepo = null;
  for (const repo of workspace.repositories) {
    if (await samePhysicalPath(repo.path, workspace.rootPath)) {
      rootRepo = repo;
      break;
    }
  }
  if (!rootRepo) throw new Error('Bounded autonomous execution currently requires the Workspace itself to be a Git repository root.');

  const spec = validateAutonomySpec(payload || {});
  const worker = AUTONOMOUS_WORKERS[spec.workerId];
  const workerStatus = await probe(worker.command, ['--version']);
  if (!workerStatus.available) throw new Error(`${worker.label} is not installed or not on PATH.`);

  const runId = makeRunId();
  const runRoot = dataPath('autonomy', 'runs', runId);
  const controller = new AbortController();
  autonomyController = controller;
  autonomyRecord = {
    schema: 'aecp.autonomous/v1',
    id: runId,
    state: 'PREPARING',
    sourceRoot: workspace.rootPath,
    runRoot,
    workerId: spec.workerId,
    verificationProfile: spec.verificationProfile,
    goal: spec.goal,
    done: spec.done,
    maxIterations: spec.maxIterations,
    currentIteration: 0,
    startedAt: new Date().toISOString()
  };
  await fsp.mkdir(runRoot, { recursive: true });
  await writeJsonAtomic(path.join(runRoot, 'run.json'), autonomyRecord);

  void runBoundedAutonomy({
    runId,
    sourceRoot: workspace.rootPath,
    runRoot,
    spec,
    signal: controller.signal,
    onEvent: async (event) => {
      const current = await readJson(path.join(runRoot, 'run.json'), autonomyRecord);
      autonomyRecord = current || autonomyRecord;
      sendAutonomyEvent(event);
    }
  }).then((record) => {
    autonomyRecord = record;
    sendAutonomyEvent({
      schema: 'aecp.autonomy.event/v1',
      runId,
      at: new Date().toISOString(),
      type: 'run.final',
      state: record.state,
      data: { worktree: record.worktree || null, patchFile: record.patchFile || null }
    });
  }).catch((error) => {
    autonomyRecord = { ...autonomyRecord, state: 'FAILED', error: String(error?.message || error) };
    sendAutonomyEvent({
      schema: 'aecp.autonomy.event/v1',
      runId,
      at: new Date().toISOString(),
      type: 'run.failed',
      state: 'FAILED',
      data: { error: String(error?.message || error) }
    });
  }).finally(() => {
    if (autonomyController === controller) autonomyController = null;
  });

  return autonomyRecord;
}

async function cancelAutonomy() {
  if (!autonomyController) return latestAutonomyRecord();
  autonomyController.abort();
  return { ...(await latestAutonomyRecord()), state: 'CANCELLING' };
}

async function openAutonomyWorktree() {
  const record = await latestAutonomyRecord();
  if (!record?.worktree) throw new Error('No autonomous worktree is available.');
  const error = await shell.openPath(record.worktree);
  if (error) throw new Error(error);
  return true;
}

async function applyAutonomy() {
  if (autonomyController) throw new Error('Wait for the autonomous run to stop before applying changes.');
  const state = await loadState();
  const workspace = getCurrentWorkspace(state);
  const record = await latestAutonomyRecord();
  if (!workspace || !record) throw new Error('No autonomous result is available.');
  if (!(await samePhysicalPath(workspace.rootPath, record.sourceRoot))) {
    throw new Error('The active Workspace is different from the run source. Refusing to apply.');
  }
  const result = await applyVerifiedPatch({ sourceRoot: workspace.rootPath, runRecord: record });
  record.state = result.applied ? 'APPLIED' : 'DONE';
  record.appliedAt = result.applied ? new Date().toISOString() : null;
  record.applyResult = result;
  autonomyRecord = record;
  await writeJsonAtomic(path.join(record.runRoot, 'run.json'), record);
  return record;
}

async function githubConnection() {
  const gh = await probe('gh', ['--version']);
  if (!gh.available) return { connected: false, ghInstalled: false, message: 'GitHub CLI is not installed.' };
  try {
    await execFixed('gh', ['auth', 'status', '--hostname', 'github.com'], undefined, 8000);
    return { connected: true, ghInstalled: true, message: 'GitHub CLI is authenticated.' };
  } catch (error) {
    return {
      connected: false,
      ghInstalled: true,
      message: String(error.stderr || error.stdout || 'GitHub CLI is not authenticated.').split(/\r?\n/)[0]
    };
  }
}

async function connectGitHub() {
  const connection = await githubConnection();
  if (!connection.ghInstalled) {
    await shell.openExternal('https://cli.github.com/');
    return { ok: false, reason: 'GH_NOT_INSTALLED' };
  }
  if (connection.connected) return { ok: true, alreadyConnected: true };
  const terminal = await preferredPowerShell();
  const child = spawn(terminal, ['-NoExit', '-Command', 'gh auth login --hostname github.com --web'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return { ok: true, alreadyConnected: false };
}

async function latestRelease() {
  const connection = await githubConnection();
  if (!connection.connected) return { connection, release: null };
  const listed = await execFixed('gh', [
    'release', 'list', '--repo', UPDATE_REPO, '--limit', '20',
    '--json', 'tagName,name,isPrerelease,publishedAt'
  ], undefined, 15000);
  const selected = selectHighestRelease(JSON.parse(listed.stdout || '[]'));
  if (!selected) return { connection, release: null };
  const tag = selected.tagName;
  const viewed = await execFixed('gh', [
    'release', 'view', tag, '--repo', UPDATE_REPO,
    '--json', 'tagName,name,isPrerelease,publishedAt,url,assets'
  ], undefined, 15000);
  return { connection, release: JSON.parse(viewed.stdout) };
}

async function checkForUpdate() {
  const currentVersion = app.getVersion();
  const { connection, release } = await latestRelease();
  if (!connection.connected) {
    return {
      connected: false,
      ghInstalled: connection.ghInstalled,
      currentVersion,
      available: false,
      message: connection.message
    };
  }
  if (!release) {
    return { connected: true, ghInstalled: true, currentVersion, available: false, message: 'No GitHub Release found.' };
  }
  const latestVersion = versionFromTag(release.tagName);
  if (!latestVersion) throw new Error('Latest Release tag is not a semantic version.');
  const assetName = selectInstallerAsset(release.assets, latestVersion, process.arch);
  const available = compareVersions(latestVersion, currentVersion) > 0;
  return {
    connected: true,
    ghInstalled: true,
    currentVersion,
    latestVersion,
    tagName: release.tagName,
    releaseName: release.name,
    releaseUrl: release.url,
    prerelease: Boolean(release.isPrerelease),
    publishedAt: release.publishedAt,
    assetName,
    available,
    message: available ? 'A newer AECP Release is available.' : 'AECP is up to date.'
  };
}

async function readUpdateTransaction() {
  return readJson(dataPath('updates', 'update-state.json'), null);
}

async function writeUpdateTransaction(transaction) {
  await writeJsonAtomic(dataPath('updates', 'update-state.json'), transaction);
  return transaction;
}

async function verifyDownloadedInstaller(dir, assetName) {
  const manifest = await fsp.readFile(path.join(dir, 'SHA256SUMS.txt'), 'utf8');
  const line = manifest.split(/\r?\n/).find((item) => item.trim().endsWith(assetName));
  if (!line) throw new Error('SHA256SUMS.txt does not contain the selected installer.');
  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('SHA256SUMS.txt contains an invalid digest.');
  const installer = path.join(dir, assetName);
  const actual = crypto.createHash('sha256').update(await fsp.readFile(installer)).digest('hex').toLowerCase();
  if (expected !== actual) throw new Error('Downloaded installer failed SHA-256 verification.');
  return { installer, sha256: actual };
}

async function downloadVerifiedReleaseInstaller(tagName, version, dir) {
  const viewed = await execFixed('gh', [
    'release', 'view', tagName, '--repo', UPDATE_REPO, '--json', 'assets'
  ], undefined, 15000);
  const release = JSON.parse(viewed.stdout || '{}');
  const assetName = selectInstallerAsset(release.assets, version, process.arch);
  if (!assetName) throw new Error(`Release ${tagName} does not contain a compatible AECP installer.`);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  await execFixed('gh', [
    'release', 'download', tagName, '--repo', UPDATE_REPO,
    '--pattern', assetName, '--pattern', 'SHA256SUMS.txt',
    '--dir', dir, '--clobber'
  ], undefined, 120000);
  return { assetName, ...(await verifyDownloadedInstaller(dir, assetName)) };
}

async function retainRollbackInstaller(currentVersion) {
  const tagName = `v${currentVersion}`;
  const dir = dataPath('updates', 'rollback', tagName);
  try {
    const retained = await downloadVerifiedReleaseInstaller(tagName, currentVersion, dir);
    return { tagName, ...retained };
  } catch {
    return null;
  }
}

async function getUpdateTransactionStatus() {
  return await readUpdateTransaction();
}

async function reconcileUpdateTransaction() {
  const transaction = await readUpdateTransaction();
  if (!transaction) return null;
  const reconciled = reconcileFirstBoot(transaction, app.getVersion());
  if (JSON.stringify(reconciled) !== JSON.stringify(transaction)) await writeUpdateTransaction(reconciled);
  return reconciled;
}

async function applyUpdate() {
  const update = await checkForUpdate();
  if (!update.connected) throw new Error('Connect GitHub before applying a private update.');
  if (!update.available) throw new Error('No newer AECP Release is available.');
  if (!update.assetName) throw new Error('The Release does not contain a compatible AECP installer.');

  const targetDir = dataPath('updates', 'target', update.tagName);
  const target = await downloadVerifiedReleaseInstaller(update.tagName, update.latestVersion, targetDir);
  const rollback = await retainRollbackInstaller(update.currentVersion);

  let transaction = createUpdateTransaction({
    currentVersion: update.currentVersion,
    targetVersion: update.latestVersion,
    targetInstaller: target.installer,
    targetSha256: target.sha256,
    rollbackInstaller: rollback?.installer || null,
    rollbackSha256: rollback?.sha256 || null
  });
  transaction = transitionUpdate(transaction, 'INSTALLING', { tagName: update.tagName, assetName: target.assetName });
  await writeUpdateTransaction(transaction);

  const child = spawn(target.installer, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setTimeout(() => app.quit(), 700);
  return { ok: true, tagName: update.tagName, assetName: target.assetName, rollbackPrepared: Boolean(rollback) };
}

async function rollbackUpdate() {
  const transaction = await readUpdateTransaction();
  if (!transaction || transaction.state !== 'ROLLBACK_REQUIRED') throw new Error('No rollback-required update is available.');
  if (!transaction.rollbackInstaller || !transaction.rollbackSha256) throw new Error('A verified previous installer was not retained; automatic rollback is unavailable.');
  const actual = crypto.createHash('sha256').update(await fsp.readFile(transaction.rollbackInstaller)).digest('hex').toLowerCase();
  if (actual !== String(transaction.rollbackSha256).toLowerCase()) throw new Error('Retained rollback installer failed SHA-256 verification.');
  const rolling = transitionUpdate(transaction, 'ROLLING_BACK');
  await writeUpdateTransaction(rolling);
  const child = spawn(transaction.rollbackInstaller, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setTimeout(() => app.quit(), 700);
  return { ok: true, targetVersion: transaction.currentVersion };
}

function redactRemote(remote) {
  if (!remote) return '';
  return remote.replace(/(https?:\/\/)([^/@\s]+)@/i, '$1***@');
}

async function inspectGit(candidate) {
  try {
    const top = (await execFixed('git', ['rev-parse', '--show-toplevel'], candidate)).stdout;
    const branch = (await execFixed('git', ['branch', '--show-current'], top)).stdout || '(detached)';
    const status = (await execFixed('git', ['status', '--porcelain'], top)).stdout;
    let remote = '';
    try { remote = (await execFixed('git', ['remote', 'get-url', 'origin'], top)).stdout; } catch {}
    return {
      id: `repo-${crypto.createHash('sha1').update(top.toLowerCase()).digest('hex').slice(0, 10)}`,
      name: path.basename(top),
      path: top,
      branch,
      dirty: Boolean(status.trim()),
      remote: redactRemote(remote)
    };
  } catch {
    return null;
  }
}

async function scanRepositories(root) {
  const repos = [];
  const seen = new Set();
  const rootRepo = await inspectGit(root);
  if (rootRepo && path.resolve(rootRepo.path) === path.resolve(root)) {
    repos.push(rootRepo);
    seen.add(rootRepo.path.toLowerCase());
  }

  let entries = [];
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return repos; }
  for (const entry of entries.slice(0, 80)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const child = path.join(root, entry.name);
    const repo = await inspectGit(child);
    if (repo && path.resolve(repo.path) === path.resolve(child) && !seen.has(repo.path.toLowerCase())) {
      repos.push(repo);
      seen.add(repo.path.toLowerCase());
    }
    if (repos.length >= 24) break;
  }
  return repos;
}

async function buildWorkspace(root, existing = null) {
  const realRoot = await realDirectory(root);
  return {
    id: existing?.id || workspaceId(realRoot),
    name: existing?.name || path.basename(realRoot) || realRoot,
    rootPath: realRoot,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repositories: await scanRepositories(realRoot)
  };
}

async function appendTrace(taskId, type, data = {}, severity = 'info') {
  const dir = dataPath('evidence', taskId);
  await fsp.mkdir(dir, { recursive: true });
  const traceFile = path.join(dir, 'trace.jsonl');
  let seq = 1;
  try {
    const existing = await fsp.readFile(traceFile, 'utf8');
    seq = existing.split(/\r?\n/).filter(Boolean).length + 1;
  } catch {}
  const event = { schema: 'aecp.trace/v1', taskId, seq, at: new Date().toISOString(), type, severity, data };
  await fsp.appendFile(traceFile, `${JSON.stringify(event)}\n`, 'utf8');
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:event', event);
  return event;
}

async function persistTask(task, evidence = null) {
  const dir = dataPath('evidence', task.id);
  await fsp.mkdir(dir, { recursive: true });
  await writeJsonAtomic(path.join(dir, 'task.json'), task);
  if (evidence) await writeJsonAtomic(path.join(dir, 'evidence.json'), evidence);
  if (task.result) await writeJsonAtomic(path.join(dir, 'result.json'), task.result);
}

async function executeReadOnlyTask(task, workspace) {
  const started = Date.now();
  await appendTrace(task.id, 'execution.started', { adapter: task.card.action.type, workspace: workspace.id });
  let facts = [];
  let evidence = {};

  if (task.card.action.type === 'inspect-workspace') {
    const tools = await detectTools();
    const repos = await scanRepositories(workspace.rootPath);
    facts = [
      `Workspace: ${workspace.name}`,
      `Repositories detected: ${repos.length}`,
      `Local tools available: ${tools.filter((tool) => tool.available).length}/${tools.length}`
    ];
    evidence = { workspace: { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath }, repositories: repos, tools };
  } else if (task.card.action.type === 'git-status') {
    const repo = await inspectGit(workspace.rootPath);
    if (!repo || path.resolve(repo.path) !== path.resolve(workspace.rootPath)) throw new Error('Workspace root is not a Git repository. Choose a repository root or use inspect-workspace.');
    const status = await execFixed('git', ['status', '--short', '--branch'], workspace.rootPath);
    facts = [`Repository: ${repo.name}`, `Branch: ${repo.branch}`, `Working tree: ${repo.dirty ? 'dirty' : 'clean'}`];
    evidence = { repository: repo, status: status.stdout };
  } else {
    throw new Error('Unsupported local capability.');
  }

  const durationMs = Date.now() - started;
  await appendTrace(task.id, 'verification.completed', { status: 'PASS', method: 'operation-success' });
  return { facts, evidence, durationMs };
}

async function runTask(taskId) {
  const state = await loadState();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error('Task not found.');
  const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
  if (!workspace) throw new Error('Task Workspace no longer exists.');
  if (!['READY', 'FAILED'].includes(task.state)) throw new Error(`Task cannot run from state ${task.state}.`);

  task.state = 'RUNNING';
  task.updatedAt = new Date().toISOString();
  await saveState(state);

  try {
    const output = await executeReadOnlyTask(task, workspace);
    task.state = 'DONE';
    task.result = makeResultCapsule({
      taskId: task.id,
      status: 'PASS',
      summary: 'Read-only local execution completed and verification passed.',
      durationMs: output.durationMs,
      verification: { status: 'PASS', method: 'operation-success', expected: true, actual: true },
      evidenceRef: `local://evidence/${task.id}`,
      facts: output.facts
    });
    task.resultHash = hashJson(task.result);
    task.updatedAt = new Date().toISOString();
    await persistTask(task, output.evidence);
    await appendTrace(task.id, 'task.completed', { status: 'PASS', resultHash: task.resultHash });
    await saveState(state);
    return { ok: true, task };
  } catch (error) {
    task.state = 'FAILED';
    task.result = makeResultCapsule({
      taskId: task.id,
      status: 'FAIL',
      summary: error.message,
      durationMs: 0,
      verification: { status: 'FAIL', method: 'operation-success', expected: true, actual: false },
      evidenceRef: `local://evidence/${task.id}`,
      facts: []
    });
    task.updatedAt = new Date().toISOString();
    await persistTask(task, { error: error.message });
    await appendTrace(task.id, 'task.failed', { message: error.message }, 'error');
    await saveState(state);
    return { ok: false, task, error: error.message };
  }
}

async function loadSecrets() {
  return readJson(dataPath('credentials.json'), { schemaVersion: 1, values: {} });
}

async function buildRuntimeProviderRouter() {
  const state = await loadState();
  const secrets = await loadSecrets();
  const registry = Object.fromEntries(Object.entries(PROVIDERS).map(([id, provider]) => [id, { ...provider, roles: [...(provider.roles || [])] }]));
  for (const item of state.providers || []) {
    if (item.kind === 'local-command') {
      if (!item.command) continue;
      registry[item.id] = {
        mode: 'local-command',
        command: item.command,
        args: Array.isArray(item.args) ? item.args : [],
        defaultModel: item.defaultModel || null,
        roles: Array.isArray(item.roles) && item.roles.length ? item.roles : ['planner', 'builder', 'reviewer', 'general'],
        network: false,
        credential: false,
        kind: item.kind
      };
      continue;
    }
    if (!['api', 'local'].includes(item.kind) || !item.baseUrl || !item.defaultModel) continue;
    let apiKey = '';
    const encrypted = secrets.values?.[item.id];
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      try { apiKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch {}
    }
    registry[item.id] = {
      mode: 'openai-compatible',
      baseUrl: item.baseUrl,
      defaultModel: item.defaultModel,
      roles: Array.isArray(item.roles) && item.roles.length ? item.roles : ['planner', 'reviewer', 'general'],
      apiKey,
      network: true,
      credential: Boolean(apiKey),
      kind: item.kind
    };
  }
  return new ProviderRouter(registry);
}

async function refreshRuntimeProviders() {
  if (controlPlane) controlPlane.providers = await buildRuntimeProviderRouter();
}

async function getOrCreateLocalMcpToken() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable; Local MCP cannot start safely.');
  const secrets = await loadSecrets();
  const key = '__aecp_local_mcp_token';
  if (secrets.values[key]) {
    return safeStorage.decryptString(Buffer.from(secrets.values[key], 'base64'));
  }
  const token = crypto.randomBytes(32).toString('base64url');
  secrets.values[key] = safeStorage.encryptString(token).toString('base64');
  await writeJsonAtomic(dataPath('credentials.json'), secrets);
  return token;
}

function publicMcpStatus() {
  if (!mcpRuntime) {
    return { running: false, mode: 'read-only', url: null, workspaceId: null };
  }
  return {
    running: true,
    mode: mcpRuntime.mode,
    url: mcpRuntime.url,
    healthUrl: mcpRuntime.healthUrl,
    workspaceId: mcpRuntime.workspaceId
  };
}

async function stopLocalMcp() {
  if (!mcpRuntime) return publicMcpStatus();
  const current = mcpRuntime;
  mcpRuntime = null;
  await current.stop();
  return publicMcpStatus();
}

async function startLocalMcp() {
  const state = await loadState();
  const workspace = getCurrentWorkspace(state);
  if (!workspace) throw new Error('Choose a Workspace before starting Local MCP.');

  if (mcpRuntime?.workspaceId === workspace.id) return publicMcpStatus();
  if (mcpRuntime) await stopLocalMcp();

  const token = await getOrCreateLocalMcpToken();
  const moduleUrl = pathToFileURL(path.join(__dirname, 'mcp-server.mjs')).href;
  const { startLocalMcpServer } = await import(moduleUrl);
  const runtime = await startLocalMcpServer({ workspaceRoot: workspace.rootPath, token, port: 39177 });
  mcpRuntime = { ...runtime, workspaceId: workspace.id };
  return publicMcpStatus();
}

async function copyLocalMcpConnection() {
  if (!mcpRuntime) throw new Error('Start Local MCP first.');
  const token = await getOrCreateLocalMcpToken();
  const text = [
    'AECP Local MCP',
    `URL=${mcpRuntime.url}`,
    `Authorization=Bearer ${token}`,
    'Mode=read-only',
    'Treat the Authorization value as a secret.'
  ].join('\n');
  clipboard.writeText(text);
  return true;
}

async function publicProviders(state) {
  const secrets = await loadSecrets();
  return [{
    id: 'chatgpt-web',
    name: 'ChatGPT Web',
    kind: 'human-mediated-web',
    status: 'READY',
    builtIn: true,
    description: 'Official ChatGPT in your normal browser. No API key required.'
  }].concat(state.providers.map((item) => ({ ...item, hasCredential: Boolean(secrets.values[item.id]) })));
}

async function saveProvider(payload) {
  const state = await loadState();
  const name = String(payload?.name || '').trim();
  const kind = String(payload?.kind || 'api');
  const baseUrl = String(payload?.baseUrl || '').trim();
  const apiKey = String(payload?.apiKey || '');
  const defaultModel = String(payload?.defaultModel || '').trim().slice(0, 200);
  const command = String(payload?.command || '').trim().slice(0, 2048);
  const args = String(payload?.args || '').trim().split(/\s+/).filter(Boolean).slice(0, 32);
  if (name.length < 2 || name.length > 80) throw new Error('Provider name must be 2–80 characters.');
  if (!['api', 'local', 'local-command', 'remote-mcp'].includes(kind)) throw new Error('Unsupported provider kind.');
  if (kind === 'local-command' && !command) throw new Error('Local command provider requires a fixed executable/command.');
  if (kind !== 'local-command' && !baseUrl) throw new Error('Provider Base URL is required.');
  let parsedUrl;
  let isLoopback = false;
  if (kind !== 'local-command') {
    try { parsedUrl = new URL(baseUrl); } catch { throw new Error('Provider Base URL is invalid.'); }
    isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
    if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLoopback)) throw new Error('Provider URL must use HTTPS, except localhost development endpoints.');
    if (kind === 'local' && !isLoopback) throw new Error('Local provider URL must resolve to loopback.');
    if (['api', 'local'].includes(kind) && !defaultModel) throw new Error('API/local provider requires a default model.');
  }

  const id = payload?.id || `provider-${crypto.randomBytes(5).toString('hex')}`;
  const existing = state.providers.find((item) => item.id === id);
  const roles = ['api', 'local'].includes(kind) ? ['planner', 'reviewer', 'general'] : (kind === 'local-command' ? ['planner', 'builder', 'reviewer', 'general'] : []);
  const provider = {
    id,
    name,
    kind,
    baseUrl: kind === 'local-command' ? '' : baseUrl,
    command: kind === 'local-command' ? command : null,
    args: kind === 'local-command' ? args : [],
    defaultModel: defaultModel || null,
    roles,
    status: kind === 'local-command' || kind === 'remote-mcp' || defaultModel ? 'CONFIGURED' : 'NOT_CONFIGURED',
    credentialRef: apiKey ? `cred:${id}` : (existing?.credentialRef || null),
    updatedAt: new Date().toISOString()
  };
  const index = state.providers.findIndex((item) => item.id === id);
  if (index >= 0) state.providers[index] = provider; else state.providers.push(provider);

  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable; key was not saved.');
    const secrets = await loadSecrets();
    secrets.values[id] = safeStorage.encryptString(apiKey).toString('base64');
    await writeJsonAtomic(dataPath('credentials.json'), secrets);
  }
  await saveState(state);
  await refreshRuntimeProviders();
  return (await publicProviders(state)).find((item) => item.id === id);
}

async function deleteProvider(providerId) {
  if (!providerId || providerId === 'chatgpt-web') throw new Error('Built-in ChatGPT Web provider cannot be deleted.');
  const state = await loadState();
  state.providers = state.providers.filter((item) => item.id !== providerId);
  const secrets = await loadSecrets();
  delete secrets.values[providerId];
  await writeJsonAtomic(dataPath('credentials.json'), secrets);
  await saveState(state);
  await refreshRuntimeProviders();
  return true;
}

async function exportBackup() {
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const chosen=await dialog.showSaveDialog(mainWindow,{
    title:'Export AECP Backup',
    defaultPath:`AECP-Backup-${stamp}.aecp-backup.json`,
    filters:[{name:'AECP Backup',extensions:['json']}]
  });
  if(chosen.canceled||!chosen.filePath)return null;
  return writeBackup(dataPath(),chosen.filePath,{appVersion:app.getVersion()});
}

async function restoreBackup() {
  const chosen=await dialog.showOpenDialog(mainWindow,{
    title:'Restore AECP Backup',
    properties:['openFile'],
    filters:[{name:'AECP Backup',extensions:['json']}]
  });
  if(chosen.canceled||!chosen.filePaths[0])return null;
  const approval=await dialog.showMessageBox(mainWindow,{
    type:'warning',
    buttons:['Cancel','Validate, stage & restart'],
    defaultId:0,
    cancelId:0,
    noLink:true,
    title:'Restore AECP backup?',
    message:'Restore AECP local state from this backup and restart the app?',
    detail:'The backup is hash-verified and staged first. Provider credentials are intentionally excluded and will not be overwritten. A pre-restore copy is retained locally.'
  });
  if(approval.response!==1)return null;
  const request=await stageRestore(dataPath(),chosen.filePaths[0]);
  app.relaunch();
  app.exit(0);
  return request;
}

function registerIpc() {
  ipcMain.handle('app:info', async () => ({
    name: 'AI Engineering Control Plane',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    userDataPath: app.getPath('userData')
  }));

  ipcMain.handle('guidance:recommend', async (_event, payload) => {
    const state = await loadState();
    const cp = controlPlane ? await controlPlane.status() : null;
    return recommendNextAction({
      hasWorkspace: Boolean(getCurrentWorkspace(state)),
      tasks: [...(cp?.tasks || []), ...(state.tasks || [])],
      approvals: cp?.approvals || [],
      chatgptOpened: Boolean(payload?.chatgptOpened),
      harnessState: harnessRecord?.state || null
    });
  });

  ipcMain.handle('backup:export', exportBackup);
  ipcMain.handle('backup:restore', restoreBackup);

  ipcMain.handle('state:get', async () => {
    const state = await loadState();
    return { ...state, currentWorkspace: getCurrentWorkspace(state), providers: await publicProviders(state) };
  });

  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose AECP Workspace', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const state = await loadState();
    const root = await realDirectory(result.filePaths[0]);
    const id = workspaceId(root);
    const existing = state.workspaces.find((item) => item.id === id);
    const workspace = await buildWorkspace(root, existing);
    const index = state.workspaces.findIndex((item) => item.id === id);
    if (index >= 0) state.workspaces[index] = workspace; else state.workspaces.push(workspace);
    state.currentWorkspaceId = id;
    await saveState(state);
    return workspace;
  });

  ipcMain.handle('workspace:refresh', async () => {
    const state = await loadState();
    const workspace = getCurrentWorkspace(state);
    if (!workspace) return null;
    const refreshed = await buildWorkspace(workspace.rootPath, workspace);
    state.workspaces[state.workspaces.findIndex((item) => item.id === workspace.id)] = refreshed;
    await saveState(state);
    return refreshed;
  });

  ipcMain.handle('workspace:open', async () => {
    const state = await loadState();
    const workspace = getCurrentWorkspace(state);
    if (!workspace) throw new Error('Choose a Workspace first.');
    const error = await shell.openPath(workspace.rootPath);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('workspace:terminal', async () => {
    const state = await loadState();
    const workspace = getCurrentWorkspace(state);
    if (!workspace) throw new Error('Choose a Workspace first.');
    const preferred = (await probe('pwsh', ['--version'])).available ? 'pwsh' : 'powershell';
    const safePath = workspace.rootPath.replace(/'/g, "''");
    const child = spawn(preferred, ['-NoExit', '-Command', `Set-Location -LiteralPath '${safePath}'`], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return true;
  });

  ipcMain.handle('chatgpt:open', async () => {
    await shell.openExternal('https://chatgpt.com/');
    return true;
  });

  ipcMain.handle('harness:start', async (_event, payload) => startHarness(payload));
  ipcMain.handle('control-plane:status', async () => (await initControlPlane()).status());
  ipcMain.handle('control-plane:replay', async (_e,p)=>(await initControlPlane()).replay(p?.runId,p?.limit));
  ipcMain.handle('control-plane:events', async (_event, payload) => (await initControlPlane()).listEvents(payload?.limit || 500));
  ipcMain.handle('control-plane:remote-pair', async () => (await initControlPlane()).createRemotePairing());
  ipcMain.handle('control-plane:remote-devices', async () => (await initControlPlane()).listRemoteDevices());
  ipcMain.handle('control-plane:remote-revoke', async (_event,payload) => (await initControlPlane()).revokeRemoteDevice(payload?.deviceId));
  ipcMain.handle('control-plane:create-mission', async (_event, payload) => {
    const state = await loadState();
    const workspace = getCurrentWorkspace(state);
    if (!workspace) throw new Error('Choose a Workspace first.');
    return (await initControlPlane()).createMission({
      ...payload,
      sourceRoot: workspace.rootPath,
      autoStart: payload?.autoStart !== false
    });
  });
  ipcMain.handle('control-plane:start', async (_event, payload) => (await initControlPlane()).startMission(payload?.runId));
  ipcMain.handle('control-plane:pause', async (_event, payload) => (await initControlPlane()).pauseMission(payload?.runId));
  ipcMain.handle('control-plane:cancel', async (_event, payload) => (await initControlPlane()).cancelMission(payload?.runId));
  ipcMain.handle('control-plane:approve', async (_event, payload) => (await initControlPlane()).approve(payload?.approvalId, { by: 'human', note: payload?.note || '' }));
  ipcMain.handle('control-plane:approve-delivery', async (_e,p)=>controlPlane.approveDelivery(p.runId,p.taskId,p));
  ipcMain.handle('control-plane:reject', async (_event, payload) => (await initControlPlane()).reject(payload?.approvalId, { by: 'human', note: payload?.note || 'Rejected by operator.' }));

  ipcMain.handle('harness:status', harnessStatus);
  ipcMain.handle('harness:cancel', cancelHarness);
  ipcMain.handle('autonomy:options', autonomyOptions);
  ipcMain.handle('autonomy:status', latestAutonomyRecord);
  ipcMain.handle('autonomy:start', async (_event, payload) => startAutonomy(payload));
  ipcMain.handle('autonomy:cancel', cancelAutonomy);
  ipcMain.handle('autonomy:open-worktree', openAutonomyWorktree);
  ipcMain.handle('autonomy:apply', applyAutonomy);

  ipcMain.handle('mcp:status', async () => publicMcpStatus());
  ipcMain.handle('mcp:start', startLocalMcp);
  ipcMain.handle('mcp:stop', stopLocalMcp);
  ipcMain.handle('mcp:copy-connection', copyLocalMcpConnection);

  ipcMain.handle('agents:list', detectAgents);
  ipcMain.handle('agents:launch', async (_event, payload) => launchAgent(payload?.agentId));
  ipcMain.handle('python:syntax-scan', async () => {
    const state=await loadState();
    const workspace=getCurrentWorkspace(state);
    if(!workspace) throw new Error('Choose a Workspace before running the Python syntax worker.');
    return pythonWorker.syntaxScan(workspace.rootPath);
  });
  ipcMain.handle('desktop:list-windows', async () => windowsUiAdapter.listWindows());
  ipcMain.handle('desktop:inspect-ui', async (_event,payload) => windowsUiAdapter.inspect(payload?.pid,{maxNodes:payload?.maxNodes||120,allowBrowser:false}));
  ipcMain.handle('desktop:list-browser-windows', async () => desktopAdapter.listBrowserWindows());
  ipcMain.handle('desktop:dock-browser', async (_event,payload) => {
    const pid=Number(payload?.pid);
    const side=String(payload?.side||'right');
    const approval=await dialog.showMessageBox(mainWindow,{
      type:'question',
      buttons:['Cancel','Dock browser'],
      defaultId:0,
      cancelId:0,
      noLink:true,
      title:'Allow browser window movement?',
      message:`Move allowlisted browser PID ${Number.isInteger(pid)?pid:'?'} to the ${side} half of the screen?`,
      detail:'AECP will move only the selected browser window frame. It will not read the page title, DOM, messages, cookies, or browser traffic.'
    });
    if(approval.response!==1) throw new Error('Browser docking was not approved by the operator.');
    return desktopAdapter.dockBrowserWindow({pid,side});
  });
  ipcMain.handle('github:connection', githubConnection);
  ipcMain.handle('github:connect', connectGitHub);
  ipcMain.handle('update:check', checkForUpdate);
  ipcMain.handle('update:status', getUpdateTransactionStatus);
  ipcMain.handle('update:apply', applyUpdate);
  ipcMain.handle('update:rollback', rollbackUpdate);
  ipcMain.handle('update:open-release', async () => {
    await shell.openExternal(`https://github.com/${UPDATE_REPO}/releases`);
    return true;
  });

  ipcMain.handle('tools:detect', detectTools);
  ipcMain.handle('clipboard:read', async () => clipboard.readText());
  ipcMain.handle('clipboard:write', async (_event, payload) => {
    const text = payload?.text;
    if (typeof text !== 'string' || text.length > 128 * 1024) throw new Error('Clipboard write rejected.');
    await clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('task:sample', async () => {
    const state = await loadState();
    const workspace = getCurrentWorkspace(state);
    if (!workspace) throw new Error('Choose a Workspace first.');
    const rootRepo = workspace.repositories.find((repo) => path.resolve(repo.path) === path.resolve(workspace.rootPath));
    return {
      schema: 'aecp.task/v1',
      title: rootRepo ? 'Inspect repository status' : 'Inspect Workspace',
      workspace: 'current',
      goal: 'Perform a read-only local inspection and return verified evidence. Do not modify files.',
      action: { type: rootRepo ? 'git-status' : 'inspect-workspace' },
      permissions: ['workspace:read'],
      verification: { type: 'operation-success', expected: true }
    };
  });

  ipcMain.handle('task:import', async (_event, payload) => {
    const card = parseCommandCard(payload?.text || '');
    const state = await loadState();
    const workspace = getCurrentWorkspace(state);
    if (!workspace) throw new Error('Choose a Workspace before importing a task.');
    const task = {
      id: makeTaskId(),
      workspaceId: workspace.id,
      title: card.title,
      goal: card.goal,
      state: 'READY',
      risk: 'GREEN',
      riskReason: 'Preview Command Cards expose read-only local capabilities only.',
      card,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.tasks.unshift(task);
    state.tasks = state.tasks.slice(0, 200);
    await saveState(state);
    await persistTask(task);
    await appendTrace(task.id, 'task.imported', { cardHash: hashJson(card), workspaceId: workspace.id, risk: 'GREEN' });
    return task;
  });

  ipcMain.handle('task:list', async () => (await loadState()).tasks);
  ipcMain.handle('task:execute', async (_event, payload) => runTask(payload?.taskId));

  ipcMain.handle('task:trace', async (_event, payload) => {
    const file = dataPath('evidence', payload?.taskId || '', 'trace.jsonl');
    try {
      const text = await fsp.readFile(file, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  });

  ipcMain.handle('task:evidence', async (_event, payload) => {
    const dir = dataPath('evidence', payload?.taskId || '');
    return {
      task: await readJson(path.join(dir, 'task.json'), null),
      evidence: await readJson(path.join(dir, 'evidence.json'), null),
      result: await readJson(path.join(dir, 'result.json'), null),
      localPath: dir
    };
  });

  ipcMain.handle('provider:list', async () => publicProviders(await loadState()));
  ipcMain.handle('provider:save', async (_event, payload) => saveProvider(payload));
  ipcMain.handle('provider:delete', async (_event, payload) => deleteProvider(payload?.providerId));
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'AI Engineering Control Plane',
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  await mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(async () => {
  await ensureDataDirs();
  await applyPendingRestore(dataPath());
  await reconcileUpdateTransaction();
  if (process.argv.includes('--smoke-test')) {
    process.stdout.write(JSON.stringify({ ok:true, version:app.getVersion(), arch:process.arch })+'\n');
    app.quit();
    return;
  }
  await initControlPlane();
  registerIpc();
  await createMainWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
}).catch((error) => {
  console.error(error);
  dialog.showErrorBox('AI Engineering Control Plane', error.stack || error.message);
  app.quit();
});

app.on('before-quit', () => {
  controlPlane?.shutdown().catch(() => {});
  if (mcpRuntime) {
    const current = mcpRuntime;
    mcpRuntime = null;
    current.stop().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
