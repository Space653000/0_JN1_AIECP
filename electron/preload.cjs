'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('aecp', Object.freeze({
  getAppInfo: () => call('app:info'),
  getState: () => call('state:get'),
  getWorkspacePolicy: () => call('policy:get'),
  saveWorkspacePolicy: (policy) => call('policy:save', policy),
  getAdapterCapabilityMatrix: () => call('security:adapter-matrix'),
  getGuidance: (context) => call('guidance:recommend', context),
  selectWorkspace: () => call('workspace:select'),
  refreshWorkspace: () => call('workspace:refresh'),
  addRepository: () => call('workspace:add-repo'),
  openWorkspace: () => call('workspace:open'),
  openTerminal: () => call('workspace:terminal'),
  openChatGPT: () => call('chatgpt:open'),
  startHarness: (payload) => call('harness:start', payload),
  getHarnessStatus: () => call('harness:status'),
  cancelHarness: () => call('harness:cancel'),
  getControlPlaneStatus: () => call('control-plane:status'),
  replayControlPlane: (p) => call('control-plane:replay', p),
  getControlPlaneEvents: (limit) => call('control-plane:events', { limit }),
  createRemotePairing: () => call('control-plane:remote-pair'),
  listRemoteDevices: () => call('control-plane:remote-devices'),
  revokeRemoteDevice: (deviceId) => call('control-plane:remote-revoke', { deviceId }),
  createMission: (payload) => call('control-plane:create-mission', payload),
  startMission: (runId) => call('control-plane:start', { runId }),
  pauseMission: (runId) => call('control-plane:pause', { runId }),
  cancelMission: (runId) => call('control-plane:cancel', { runId }),
  approveMissionAction: (approvalId, note) => call('control-plane:approve', { approvalId, note }),
  approveDelivery: (p)=>ipcRenderer.invoke('control-plane:approve-delivery',p),
    rejectMissionAction: (approvalId, note) => call('control-plane:reject', { approvalId, note }),
  getAutonomyOptions: () => call('autonomy:options'),
  getAutonomyStatus: () => call('autonomy:status'),
  startAutonomy: (payload) => call('autonomy:start', payload),
  resumeAutonomy: () => call('autonomy:resume'),
  cancelAutonomy: () => call('autonomy:cancel'),
  openAutonomyWorktree: () => call('autonomy:open-worktree'),
  applyAutonomy: () => call('autonomy:apply'),
  getMcpStatus: () => call('mcp:status'),
  startMcp: () => call('mcp:start'),
  stopMcp: () => call('mcp:stop'),
  copyMcpConnection: () => call('mcp:copy-connection'),
  listAgents: () => call('agents:list'),
  launchAgent: (agentId) => call('agents:launch', { agentId }),
  scanPythonSyntax: () => call('python:syntax-scan'),
  listWindows: () => call('desktop:list-windows'),
  inspectWindowUi: (pid, maxNodes=120) => call('desktop:inspect-ui', { pid, maxNodes }),
  listBrowserWindows: () => call('desktop:list-browser-windows'),
  dockBrowserWindow: (pid, side) => call('desktop:dock-browser', { pid, side }),
  exportBackup: () => call('backup:export'),
  restoreBackup: () => call('backup:restore'),
  clearEvidence: () => call('data:clear-evidence'),
  removeWorkspaceBinding: () => call('data:remove-workspace'),
  clearStoredCredentials: () => call('data:clear-credentials'),
  resetLocalState: () => call('data:reset-state'),
  getGitHubConnection: () => call('github:connection'),
  connectGitHub: () => call('github:connect'),
  checkUpdate: () => call('update:check'),
  getUpdateStatus: () => call('update:status'),
  applyUpdate: () => call('update:apply'),
  rollbackUpdate: () => call('update:rollback'),
  openReleases: () => call('update:open-release'),
  detectTools: () => call('tools:detect'),
  readClipboard: () => call('clipboard:read'),
  writeClipboard: (text) => call('clipboard:write', { text }),
  importTask: (text) => call('task:import', { text }),
  sampleTask: () => call('task:sample'),
  listTasks: () => call('task:list'),
  executeTask: (taskId) => call('task:execute', { taskId }),
  getTaskTrace: (taskId) => call('task:trace', { taskId }),
  getTaskEvidence: (taskId) => call('task:evidence', { taskId }),
  listProviders: () => call('provider:list'),
  listWorkers: () => call('worker:list'),
  loginOfficialWorker: () => call('worker:login-official'),
  checkProviderHealth: (providerId, options) => call('provider:health', { providerId, ...(options || {}) }),
  saveProvider: (provider) => call('provider:save', provider),
  deleteProvider: (providerId) => call('provider:delete', { providerId }),
  onControlPlaneEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('control-plane:event', handler);
    return () => ipcRenderer.removeListener('control-plane:event', handler);
  },
  onHarnessEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('autonomy:event', handler);
    return () => ipcRenderer.removeListener('autonomy:event', handler);
  },
  onAutonomyEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('autonomy:event', handler);
    return () => ipcRenderer.removeListener('autonomy:event', handler);
  },
  onTaskEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('task:event', handler);
    return () => ipcRenderer.removeListener('task:event', handler);
  }
}));
