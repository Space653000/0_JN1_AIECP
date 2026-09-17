'use strict';

const state = {
  app: null,
  data: null,
  tools: [],
  tasks: [],
  providers: [],
  selectedTaskId: null,
  view: 'board',
  engineering: false,
  theme: localStorage.getItem('aecp-theme') || 'dark'
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toastRegion').appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

async function safe(action, fallback = null) {
  try { return await action(); }
  catch (error) { toast(error?.message || String(error), 'error'); return fallback; }
}

function selectedTask() {
  return state.tasks.find((task) => task.id === state.selectedTaskId) || state.tasks[0] || null;
}

function formatTime(iso) {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)); }
  catch { return iso; }
}

function statusClass(value) {
  if (['DONE', 'PASS', 'READY'].includes(value)) return 'ready';
  if (['FAILED', 'BLOCKED'].includes(value)) return 'bad';
  if (['RUNNING', 'VERIFYING', 'WAITING_USER'].includes(value)) return 'warn';
  return 'neutral';
}

async function loadAll() {
  const [app, data, tools, tasks, providers] = await Promise.all([
    safe(() => window.aecp.getAppInfo()),
    safe(() => window.aecp.getState()),
    safe(() => window.aecp.detectTools(), []),
    safe(() => window.aecp.listTasks(), []),
    safe(() => window.aecp.listProviders(), [])
  ]);
  state.app = app;
  state.data = data;
  state.tools = tools || [];
  state.tasks = tasks || [];
  state.providers = providers || [];
  if (!state.selectedTaskId && state.tasks[0]) state.selectedTaskId = state.tasks[0].id;
  if (state.selectedTaskId && !state.tasks.some((task) => task.id === state.selectedTaskId)) state.selectedTaskId = state.tasks[0]?.id || null;
  render();
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle('engineering-mode', state.engineering);
  $('#modeButton').textContent = state.engineering ? 'Engineering' : 'Beginner';
  $('#versionText').textContent = state.app ? `v${state.app.version} · ${state.app.arch}` : 'Preview';
  renderWorkspace();
  renderTools();
  renderProviders();
  renderTabs();
  renderControl();
  $('#welcomeOverlay').classList.toggle('hidden', Boolean(state.data?.currentWorkspace));
}

function renderWorkspace() {
  const workspace = state.data?.currentWorkspace;
  $('#workspaceName').textContent = workspace?.name || 'Choose Workspace';
  $('#workspacePath').textContent = workspace?.rootPath || 'Choose the folder AECP is allowed to inspect.';
  $('#workspaceState').textContent = workspace ? 'Bound' : 'Not set';
  $('#workspaceState').className = `status ${workspace ? 'ready' : 'neutral'}`;
  $('#workspaceButton .dot').className = `dot ${workspace ? 'ready' : 'idle'}`;
  $('#openWorkspaceButton').disabled = !workspace;
  $('#terminalButton').disabled = !workspace;

  const repos = workspace?.repositories || [];
  $('#repoCount').textContent = String(repos.length);
  const list = $('#repoList');
  if (!repos.length) {
    list.className = 'stack-list empty-list';
    list.textContent = workspace ? 'No Git repositories detected at the Workspace root or its direct child folders.' : 'Choose a Workspace first.';
    return;
  }
  list.className = 'stack-list';
  list.innerHTML = repos.map((repo) => `
    <article class="repo-item">
      <div class="repo-top"><span class="repo-name">${esc(repo.name)}</span><span class="status ${repo.dirty ? 'warn' : 'ready'}">${repo.dirty ? 'Dirty' : 'Clean'}</span></div>
      <div class="repo-meta">${esc(repo.branch)} · ${esc(repo.remote || 'local only')}</div>
    </article>`).join('');
}

function renderTools() {
  const available = state.tools.filter((tool) => tool.available).length;
  $('#toolCount').textContent = `${available}/${state.tools.length || 0}`;
  $('#toolList').innerHTML = state.tools.map((tool) => `
    <div class="tool-item ${tool.available ? '' : 'offline'}">
      <strong>${esc(tool.name)}</strong>
      <small>${esc(tool.available ? tool.version : 'Not detected')}</small>
    </div>`).join('');
}

function renderTabs() {
  $$('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  const names = { board: 'Task Board', pipeline: 'Task Pipeline', graph: 'Workspace Graph', trace: 'Execution Trace', evidence: 'Evidence' };
  $('#controlTitle').textContent = names[state.view] || 'Control Plane';
}

function renderControl() {
  const host = $('#controlContent');
  if (!state.data?.currentWorkspace) {
    host.innerHTML = `<div class="empty-state"><div><h3>Choose a Workspace</h3><p>AECP needs one explicit local folder boundary before it can create tasks or collect evidence.</p><button class="primary-button" data-action="choose-workspace">Choose folder</button></div></div>`;
    return;
  }
  if (state.view === 'board') renderBoard(host);
  else if (state.view === 'pipeline') renderPipeline(host);
  else if (state.view === 'graph') renderGraph(host);
  else if (state.view === 'trace') renderTrace(host);
  else if (state.view === 'evidence') renderEvidence(host);
}

function taskColumn(task) {
  if (task.state === 'DONE') return 'DONE';
  if (task.state === 'FAILED' || task.state === 'BLOCKED') return 'FAILED';
  if (['RUNNING', 'VERIFYING'].includes(task.state)) return 'RUNNING';
  return 'READY';
}

function renderBoard(host) {
  const groups = [
    ['READY', 'Ready'],
    ['RUNNING', 'Running'],
    ['DONE', 'Done'],
    ['FAILED', 'Needs attention']
  ];
  const columns = groups.map(([key, label]) => {
    const tasks = state.tasks.filter((task) => taskColumn(task) === key);
    return `<section class="board-column"><div class="board-column-title"><span>${label.toUpperCase()}</span><span>${tasks.length}</span></div>${tasks.map(taskCardHtml).join('') || '<div class="empty-list">No tasks</div>'}</section>`;
  }).join('');
  const task = selectedTask();
  host.innerHTML = `<div class="board">${columns}</div>${task ? taskDetailHtml(task) : `<div class="empty-state"><div><h3>No tasks yet</h3><p>Import a Command Card from ChatGPT or create the safe sample task from the right pane.</p></div></div>`}`;
}

function taskCardHtml(task) {
  return `<article class="task-card ${task.id === state.selectedTaskId ? 'selected' : ''}" data-task-id="${esc(task.id)}">
    <h4>${esc(task.title)}</h4>
    <p>${esc(task.goal)}</p>
    <div class="task-meta"><span>${esc(task.card?.action?.type || 'task')}</span><span>${esc(task.state)}</span></div>
  </article>`;
}

function taskDetailHtml(task) {
  const canRun = ['READY', 'FAILED'].includes(task.state);
  const canCopy = Boolean(task.result);
  return `<section class="task-detail">
    <div class="card-title-row"><div><span class="eyebrow">SELECTED TASK</span><h3>${esc(task.title)}</h3></div><span class="status ${statusClass(task.state)}">${esc(task.state)}</span></div>
    <p class="muted">${esc(task.goal)}</p>
    <div class="detail-grid">
      <div class="detail-cell"><small>Task ID</small><code>${esc(task.id)}</code></div>
      <div class="detail-cell"><small>Capability</small><strong>${esc(task.card?.action?.type)}</strong></div>
      <div class="detail-cell"><small>Risk</small><strong>${esc(task.risk || 'GREEN')}</strong></div>
      <div class="detail-cell"><small>Created</small><strong>${esc(formatTime(task.createdAt))}</strong></div>
    </div>
    <div class="task-actions">
      <button class="primary-button" data-action="run-task" data-task-id="${esc(task.id)}" ${canRun ? '' : 'disabled'}>Run locally</button>
      <button class="secondary-button" data-action="copy-result" data-task-id="${esc(task.id)}" ${canCopy ? '' : 'disabled'}>Copy Result Capsule</button>
      <button class="secondary-button" data-action="show-evidence" data-task-id="${esc(task.id)}">Evidence</button>
    </div>
  </section>`;
}

function renderPipeline(host) {
  const task = selectedTask();
  if (!task) {
    host.innerHTML = `<div class="empty-state"><div><h3>No selected task</h3><p>Create or select a task to see its governed pipeline.</p></div></div>`;
    return;
  }
  const order = ['UNDERSTAND', 'PREPARE', 'EXECUTE', 'VERIFY', 'PACKAGE RESULT'];
  let progress = 0;
  if (task.state === 'READY') progress = 1;
  if (task.state === 'RUNNING') progress = 2;
  if (task.state === 'VERIFYING') progress = 3;
  if (task.state === 'DONE') progress = 5;
  if (task.state === 'FAILED') progress = 3;
  host.innerHTML = `<div class="pipeline">${order.map((name, index) => {
    const done = index < progress;
    const active = index === progress && progress < order.length;
    const descriptions = ['Validate Command Card and Workspace binding.', 'Resolve capability and local resources.', 'Execute the bounded local adapter.', 'Verify operation success and evidence.', 'Generate a compact Result Capsule.'];
    return `<div class="pipeline-step ${done ? 'done' : ''} ${active ? 'active' : ''}"><div class="step-node">${done ? '✓' : index + 1}</div><div class="step-body"><strong>${name}</strong><small>${descriptions[index]}</small></div></div>`;
  }).join('')}</div>`;
}

function renderGraph(host) {
  const workspace = state.data.currentWorkspace;
  const repos = workspace.repositories || [];
  const providers = state.providers || [];
  const tools = state.tools.filter((tool) => tool.available);
  host.innerHTML = `<div class="graph-canvas">
    <div class="graph-center"><div class="graph-node"><strong>${esc(workspace.name)}</strong><small>WORKSPACE · policy boundary</small></div></div>
    <div class="graph-branches">
      <div class="graph-branch"><div class="graph-branch-label">REPOSITORIES</div>${repos.map((repo) => `<div class="graph-node"><strong>${esc(repo.name)}</strong><small>${esc(repo.branch)} · ${repo.dirty ? 'dirty' : 'clean'}</small></div>`).join('') || '<div class="graph-node"><strong>None</strong><small>No repository detected</small></div>'}</div>
      <div class="graph-branch"><div class="graph-branch-label">PROVIDERS</div>${providers.map((provider) => `<div class="graph-node"><strong>${esc(provider.name)}</strong><small>${esc(provider.kind)} · ${esc(provider.status)}</small></div>`).join('')}</div>
      <div class="graph-branch"><div class="graph-branch-label">LOCAL TOOLS</div>${tools.slice(0, 8).map((tool) => `<div class="graph-node"><strong>${esc(tool.name)}</strong><small>${esc(tool.version)}</small></div>`).join('') || '<div class="graph-node"><strong>Detecting</strong><small>No tools available</small></div>'}</div>
    </div>
  </div>`;
}

async function renderTrace(host) {
  const task = selectedTask();
  if (!task) { host.innerHTML = `<div class="empty-state"><div><h3>No trace yet</h3><p>Select a task first.</p></div></div>`; return; }
  host.innerHTML = `<div class="empty-state"><div><h3>Loading trace…</h3></div></div>`;
  const trace = await safe(() => window.aecp.getTaskTrace(task.id), []);
  if (state.view !== 'trace') return;
  host.innerHTML = `<div class="trace-list">${trace.map((event) => `<div class="trace-event ${esc(event.severity)}"><time>${esc(formatTime(event.at))}</time><strong>${esc(event.type)}</strong><span>${esc(JSON.stringify(event.data))}</span></div>`).join('') || '<div class="empty-list">No events recorded.</div>'}</div>`;
}

async function renderEvidence(host) {
  const task = selectedTask();
  if (!task) { host.innerHTML = `<div class="empty-state"><div><h3>No evidence yet</h3><p>Run a task to produce local evidence.</p></div></div>`; return; }
  host.innerHTML = `<div class="empty-state"><div><h3>Loading evidence…</h3></div></div>`;
  const payload = await safe(() => window.aecp.getTaskEvidence(task.id), null);
  if (state.view !== 'evidence') return;
  if (!payload?.result && !payload?.evidence) {
    host.innerHTML = `<div class="empty-state"><div><h3>No execution evidence yet</h3><p>This task has not completed a local run.</p><button class="primary-button" data-action="run-task" data-task-id="${esc(task.id)}">Run locally</button></div></div>`;
    return;
  }
  host.innerHTML = `<section class="task-detail">
    <div class="card-title-row"><div><span class="eyebrow">LOCAL EVIDENCE</span><h3>${esc(task.title)}</h3></div><span class="status ${statusClass(payload.result?.status)}">${esc(payload.result?.status || task.state)}</span></div>
    <p class="path-text">Stored locally: ${esc(payload.localPath)}</p>
    <h3>Result Capsule</h3><pre class="code-block">${esc(JSON.stringify(payload.result, null, 2))}</pre>
    <h3>Evidence</h3><pre class="code-block">${esc(JSON.stringify(payload.evidence, null, 2))}</pre>
    <div class="task-actions"><button class="primary-button" data-action="copy-result" data-task-id="${esc(task.id)}" ${payload.result ? '' : 'disabled'}>Copy Result Capsule</button></div>
  </section>`;
}

function renderProviders() {
  const host = $('#providerList');
  host.innerHTML = state.providers.map((provider) => `<div class="provider-item"><div><strong>${esc(provider.name)}</strong><small>${esc(provider.kind)} · ${esc(provider.status)}${provider.hasCredential ? ' · credential stored' : ''}${provider.baseUrl ? ` · ${esc(provider.baseUrl)}` : ''}</small></div>${provider.builtIn ? '<span class="status ready">Built in</span>' : `<button class="secondary-button" data-delete-provider="${esc(provider.id)}" type="button">Remove</button>`}</div>`).join('');
}

async function chooseWorkspace() {
  const workspace = await safe(() => window.aecp.selectWorkspace());
  if (!workspace) return;
  $('#welcomeOverlay').classList.add('hidden');
  toast(`Workspace connected: ${workspace.name}`);
  await loadAll();
}

async function refreshWorkspace() {
  await safe(() => window.aecp.refreshWorkspace());
  await loadAll();
  toast('Local Workspace refreshed.');
}

async function importFromClipboard() {
  const text = await safe(() => window.aecp.readClipboard());
  if (!text) return;
  const task = await safe(() => window.aecp.importTask(text));
  if (!task) return;
  state.selectedTaskId = task.id;
  state.view = 'board';
  toast(`Task imported: ${task.title}`);
  await loadAll();
}

async function createSampleTask() {
  const sample = await safe(() => window.aecp.sampleTask());
  if (!sample) return;
  const task = await safe(() => window.aecp.importTask(JSON.stringify(sample, null, 2)));
  if (!task) return;
  state.selectedTaskId = task.id;
  state.view = 'board';
  toast('Safe sample task created.');
  await loadAll();
}

async function runTask(taskId) {
  toast('Running local read-only capability…');
  const result = await safe(() => window.aecp.executeTask(taskId));
  if (result?.task) state.selectedTaskId = result.task.id;
  await loadAll();
  toast(result?.ok ? 'Task verified successfully.' : (result?.error || 'Task failed.'), result?.ok ? 'info' : 'error');
}

async function copyResult(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task?.result) { toast('Run the task first; no Result Capsule exists yet.', 'error'); return; }
  const framed = `AECP_RESULT_CAPSULE_V1\n${JSON.stringify(task.result, null, 2)}`;
  const ok = await safe(() => window.aecp.writeClipboard(framed));
  if (ok) toast('Result Capsule copied. Paste it into your ChatGPT conversation.');
}

function setView(view) {
  state.view = view;
  renderTabs();
  renderControl();
}

function bindEvents() {
  $('#workspaceButton').addEventListener('click', chooseWorkspace);
  $('#chooseWorkspaceButton').addEventListener('click', chooseWorkspace);
  $('#welcomeChooseButton').addEventListener('click', chooseWorkspace);
  $('#refreshButton').addEventListener('click', refreshWorkspace);
  $('#openWorkspaceButton').addEventListener('click', () => safe(() => window.aecp.openWorkspace()));
  $('#terminalButton').addEventListener('click', () => safe(() => window.aecp.openTerminal()));
  $('#openChatGPTButton').addEventListener('click', () => safe(() => window.aecp.openChatGPT()));
  $('#importClipboardButton').addEventListener('click', importFromClipboard);
  $('#sampleButton').addEventListener('click', createSampleTask);
  $('#modeButton').addEventListener('click', () => { state.engineering = !state.engineering; if (!state.engineering && state.view === 'trace') state.view = 'board'; render(); });
  $('#themeButton').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('aecp-theme', state.theme); render(); });
  $('#settingsButton').addEventListener('click', () => $('#providerOverlay').classList.remove('hidden'));
  $('#closeProviderButton').addEventListener('click', () => $('#providerOverlay').classList.add('hidden'));
  $('#cancelProviderButton').addEventListener('click', () => $('#providerOverlay').classList.add('hidden'));
  $$('.view-tab').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

  $('#providerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: $('#providerNameInput').value,
      kind: $('#providerKindInput').value,
      baseUrl: $('#providerUrlInput').value,
      apiKey: $('#providerKeyInput').value
    };
    const saved = await safe(() => window.aecp.saveProvider(payload));
    if (!saved) return;
    event.target.reset();
    state.providers = await safe(() => window.aecp.listProviders(), state.providers);
    renderProviders();
    toast(`Provider registered: ${saved.name}`);
  });

  document.addEventListener('click', async (event) => {
    const taskCard = event.target.closest('[data-task-id].task-card');
    if (taskCard) {
      state.selectedTaskId = taskCard.dataset.taskId;
      renderControl();
      return;
    }
    const actionNode = event.target.closest('[data-action]');
    if (actionNode) {
      const action = actionNode.dataset.action;
      const taskId = actionNode.dataset.taskId;
      if (action === 'choose-workspace') await chooseWorkspace();
      if (action === 'run-task') await runTask(taskId);
      if (action === 'copy-result') await copyResult(taskId);
      if (action === 'show-evidence') { state.selectedTaskId = taskId; setView('evidence'); }
      return;
    }
    const deleteNode = event.target.closest('[data-delete-provider]');
    if (deleteNode) {
      const id = deleteNode.dataset.deleteProvider;
      if (confirm('Remove this optional provider and its stored credential from AECP?')) {
        const ok = await safe(() => window.aecp.deleteProvider(id));
        if (ok) {
          state.providers = await safe(() => window.aecp.listProviders(), state.providers);
          renderProviders();
          toast('Provider removed.');
        }
      }
    }
  });

  window.aecp.onTaskEvent((event) => {
    if (state.view === 'trace' && event.taskId === state.selectedTaskId) renderControl();
  });
}

async function boot() {
  bindEvents();
  await loadAll();
}

boot();
