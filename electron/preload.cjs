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
  onTaskEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('task:event', handler);
    return () => ipcRenderer.removeListener('task:event', handler);
  }
}));
