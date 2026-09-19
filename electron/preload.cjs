'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('aecp', Object.freeze({
  getAppInfo: () => call('app:info'),
  getState: () => call('state:get'),
  selectWorkspace: () => call('workspace:select'),
  refreshWorkspace: () => call('workspace:refresh'),
  openWorkspace: () => call('workspace:open'),
  openTerminal: () => call('workspace:terminal'),
  openChatGPT: () => call('chatgpt:open'),
  startHarness: (payload) => call('harness:start', payload),
  getHarnessStatus: () => call('harness:status'),
  cancelHarness: () => call('harness:cancel'),
  getControlPlaneStatus: () => call('control-plane:status'),
  getControlPlaneEvents: (limit) => call('control-plane:events', { limit }),
  createMission: (payload) => call('control-plane:create-mission', payload),
  startMission: (runId) => call('control-plane:start', { runId }),
  pauseMission: (runId) => call('control-plane:pause', { runId }),
  cancelMission: (runId) => call('control-plane:cancel', { runId }),
  approveMissionAction: (approvalId, note) => call('control-plane:approve', { approvalId, note }),
  rejectMissionAction: (approvalId, note) => call('control-plane:reject', { approvalId, note }),
  getAutonomyOptions: () => call('autonomy:options'),
  getAutonomyStatus: () => call('autonomy:status'),
  startAutonomy: (payload) => call('autonomy:start', payload),
  cancelAutonomy: () => call('autonomy:cancel'),
  openAutonomyWorktree: () => call('autonomy:open-worktree'),
  applyAutonomy: () => call('autonomy:apply'),
  getMcpStatus: () => call('mcp:status'),
  startMcp: () => call('mcp:start'),
  stopMcp: () => call('mcp:stop'),
  copyMcpConnection: () => call('mcp:copy-connection'),
  listAgents: () => call('agents:list'),
  launchAgent: (agentId) => call('agents:launch', { agentId }),
  getGitHubConnection: () => call('github:connection'),
  connectGitHub: () => call('github:connect'),
  checkUpdate: () => call('update:check'),
  applyUpdate: () => call('update:apply'),
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
