'use strict';

const systemPrefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;

const state = {
  app: null,
  data: null,
  tools: [],
  tasks: [],
  providers: [],
  agents: [],
  githubConnection: null,
  update: null,
  updateTransaction: null,
  mcpStatus: null;
  autonomyOptions: null,
  autonomyStatus: null,
  harnessStatus: null,
  guidance: null,
  selectedTaskId: null,
  view: 'start',
  engineering: false,
  theme: localStorage.getItem('aecp-theme') || (systemPrefersLight ? 'light' : 'dark'),
  chatgptOpened: localStorage.getItem('aecp-chatgpt-opened') === '1'
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
  if (['DONE', 'PASS', 'READY', 'APPLIED'].includes(value)) return 'ready';
  if (['FAILED', 'BLOCKED', 'BUDGET_EXHAUSTED', 'CANCELLED', 'INTERRUPTED'].includes(value)) return 'bad';
  if (['PREPARING', 'RUNNING', 'VERIFYING', 'WAITING_USER', 'CANCELLING'].includes(value)) return 'warn';
  return 'neutral';
}

async function loadAll() {
  const [app, data, tools, tasks, providers, agents, githubConnection, updateTransaction, mcpStatus, autonomyOptions, autonomyStatus, harnessStatus, guidance] = await Promise.all([
    safe(() => window.aecp.getAppInfo()),
    safe(() => window.aecp.getState()),
    safe(() => window.aecp.detectTools(), []),
    safe(() => window.aecp.listTasks(), []),
    safe(() => window.aecp.listProviders(), []),
    safe(() => window.aecp.listAgents(), []),
    safe(() => window.aecp.getGitHubConnection(), null),
    safe(() => window.aecp.getUpdateStatus(), null),
    safe(() => window.aecp.getMcpStatus(), null),
    safe(() => window.aecp.getAutonomyOptions(), null),
    safe(() => window.aecp.getAutonomyStatus(), null),
    safe(() => window.aecp.getHarnessStatus(), null),
    safe(() => window.aecp.getGuidance({ chatgptOpened: state.chatgptOpened }), null)
  ]);
  state.app = app;
  state.data = data;
  state.tools = tools || [];
  state.tasks = tasks || [];
  state.providers = providers || [];
  state.agents = agents || [];
  state.githubConnection = githubConnection;
  state.updateTransaction = updateTransaction;
  state.mcpStatus = mcpStatus;
  state.autonomyOptions = autonomyOptions;
  state.autonomyStatus = autonomyStatus;
  state.harnessStatus = harnessStatus;
  state.guidance = guidance;
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
  renderAgents();
  renderUpdate();
  renderMcp();
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
  const names = { start: 'Start', board: 'Task Board', pipeline: 'Task Pipeline', loop: 'Goal Loop', graph: 'Workspace Graph', trace: 'Execution Trace', evidence: 'Evidence' };
  $('#controlTitle').textContent = names[state.view] || 'Control Plane';
}

function renderControl() {
  const host = $('#controlContent');
  if (!state.data?.currentWorkspace) {
    host.innerHTML = `<div class="empty-state"><div><h3>Choose a Workspace</h3><p>AECP needs one explicit local folder boundary before it can create tasks or collect evidence.</p><button class="primary-button" data-action="choose-workspace">Choose folder</button></div></div>`;
    return;
  }
  if (state.view === 'start') renderStart(host);
  else if (state.view === 'board') renderBoard(host);
  else if (state.view === 'pipeline') renderPipeline(host);
  else if (state.view === 'loop') renderLoop(host);
  else if (state.view === 'graph') renderGraph(host);
  else if (state.view === 'trace') renderTrace(host);
  else if (state.view === 'evidence') renderEvidence(host);
}


function executionModeStatus() {
  const localWorkers = state.agents.filter((agent) =>
    ['codex-cli', 'claude-code', 'gemini-cli', 'opencode', 'ollama'].includes(agent.id) && agent.available
  );
  const remoteMcp = state.providers.find((provider) =>
    provider.kind === 'remote-mcp' && ['CONFIGURED', 'READY'].includes(provider.status)
  );
  const localMcpRunning = Boolean(state.mcpStatus?.running);
  const recommended = remoteMcp ? 'official-mcp' : (localWorkers.length ? 'local-autonomous' : 'web-safe');
  return { localWorkers, remoteMcp, localMcpRunning, recommended };
}

function executionModeCards() {
  const status = executionModeStatus();
  const modes = [
    {
      id: 'web-safe',
      name: 'Web Safe Bridge',
      ready: true,
      detail: 'Works with the current ChatGPT Web subscription. Explicit handoff; no DOM automation.'
    },
    {
      id: 'local-autonomous',
      name: 'Local Autonomous',
      ready: status.localWorkers.length > 0,
      detail: status.localWorkers.length
        ? `Detected workers: ${status.localWorkers.map((item) => item.name).join(', ')}. v0.3 can run a bounded isolated worktree loop with supported workers.`
        : 'Install or connect a governed local/CLI worker such as OpenCode, Ollama, Gemini CLI, Claude Code or Codex CLI.'
    },
    {
      id: 'official-mcp',
      name: 'Official Full MCP',
      ready: Boolean(status.remoteMcp),
      detail: status.remoteMcp
        ? 'Remote MCP provider configured. End-to-end tunnel/app health must still pass before write mode is enabled.'
        : (status.localMcpRunning
          ? 'Local MCP is running read-only. Add a supported ChatGPT app/tunnel to complete the official path.'
          : 'Requires a supported ChatGPT workspace plus a configured MCP app/tunnel. No ChatGPT DOM scraping.')
    }
  ];
  return `<div class="execution-mode-grid">${modes.map((mode) => `
    <article class="execution-mode-card ${mode.id === status.recommended ? 'recommended' : ''}">
      <div class="card-title-row">
        <strong>${esc(mode.name)}</strong>
        <span class="status ${mode.ready ? 'ready' : 'neutral'}">${mode.ready ? 'Ready' : 'Not ready'}</span>
      </div>
      <p>${esc(mode.detail)}</p>
      ${mode.id === status.recommended ? '<small class="mode-recommendation">Recommended on this machine</small>' : ''}
    </article>`).join('')}</div>`;
}

function renderStart(host) {
  const workspace = state.data.currentWorkspace;
  const available = state.tools.filter((tool) => tool.available).length;
  const repos = workspace.repositories?.length || 0;
  const latest = state.tasks[0];
  const nextTaskText = latest ? `${latest.title} · ${latest.state}` : 'No local task yet';
  const guidance = state.guidance || { action: 'CREATE_GOAL', label: 'Define a Goal Loop', detail: 'Create measurable work.' };
  const guidanceAction = guidance.action === 'CHOOSE_WORKSPACE' ? 'choose-workspace'
    : guidance.action === 'OPEN_CHATGPT' ? 'open-chatgpt'
    : guidance.action === 'RUN_TASK' ? 'run-task'
    : guidance.action === 'REVIEW_EVIDENCE' ? 'show-evidence'
    : guidance.action === 'WATCH_ACTIVE_WORK' ? 'show-loop'
    : guidance.action === 'REVIEW_APPROVAL' ? 'show-loop'
    : 'show-loop';
  host.innerHTML = `<section class="task-detail">
    <div class="card-title-row"><div><span class="eyebrow">GUIDED START</span><h3>What do you want to accomplish?</h3></div><span class="status ready">Ready</span></div>
    <p class="muted">Beginner mode hides the plumbing. AECP detects the environment, keeps the Workspace boundary, and shows the next useful action.</p>
    <div class="detail-grid">
      <div class="detail-cell"><small>Workspace</small><strong>${esc(workspace.name)}</strong><span>${repos} repo(s) detected</span></div>
      <div class="detail-cell"><small>Environment</small><strong>${available}/${state.tools.length || 0} tools detected</strong><span>Architecture: ${esc(state.app?.arch || 'detecting')}</span></div>
      <div class="detail-cell"><small>ChatGPT Web</small><strong>${state.chatgptOpened ? 'Opened before' : 'Ready to open'}</strong><span>Official browser session</span></div>
      <div class="detail-cell"><small>Latest work</small><strong>${esc(nextTaskText)}</strong><span>${state.tasks.length} task(s) stored locally</span></div>
    </div>
    <h3>Execution mode</h3>
    ${executionModeCards()}
    <h3>Recommended action</h3>
    <div class="privacy-note"><strong>${esc(guidance.label)}</strong><p>${esc(guidance.detail)}</p></div>
    <div class="task-actions">
      <button class="primary-button" data-action="${guidanceAction}" ${guidance.taskId ? `data-task-id="${esc(guidance.taskId)}"` : ''}>${esc(guidance.label)}</button>
      <button class="secondary-button" data-action="sample-task">Run safe local check</button>
      <button class="secondary-button" data-action="show-loop">Goal Loop</button>
      <button class="secondary-button" data-action="open-chatgpt">Open ChatGPT</button>
    </div>
    <div class="privacy-note"><strong>Automatic where safe</strong><p>Architecture, tools, repositories and Git state are detected automatically. AECP asks only for choices that affect data access, permissions, or high-risk actions.</p></div>
  </section>`;
}

function loadLoopConfig() {
  try {
    return JSON.parse(localStorage.getItem('aecp-goal-loop') || '{}');
  } catch {
    return {};
  }
}

const HARNESS_AGENT_PROVIDER = Object.freeze({
  'claude-code': { id: 'claude', roles: ['planner', 'reviewer'] },
  'codex-cli': { id: 'codex', roles: ['builder'] },
  'gemini-cli': { id: 'gemini', roles: ['planner', 'builder', 'reviewer'] },
  'opencode': { id: 'opencode', roles: ['planner', 'builder', 'reviewer'] },
  'ollama': { id: 'ollama', roles: ['planner', 'reviewer'] }
});

function harnessProviderChoices(role) {
  const choices = [];
  for (const agent of state.agents || []) {
    const mapped = HARNESS_AGENT_PROVIDER[agent.id];
    if (!mapped || !mapped.roles.includes(role) || !agent.available) continue;
    choices.push({ id: mapped.id, label: agent.name, kind: agent.kind || 'cli', hasCredential: false });
  }
  for (const provider of state.providers || []) {
    if (!provider || provider.id === 'chatgpt-web' || provider.kind === 'remote-mcp') continue;
    if (!Array.isArray(provider.roles) || !provider.roles.includes(role)) continue;
    choices.push({ id: provider.id, label: provider.name, kind: provider.kind, hasCredential: Boolean(provider.hasCredential), defaultModel: provider.defaultModel || '' });
  }
  const seen = new Set();
  return choices.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

function defaultHarnessProvider(role, choices) {
  const preferred = role === 'builder' ? ['codex', 'opencode', 'gemini'] : ['claude', 'gemini', 'opencode', 'ollama'];
  return preferred.find((id) => choices.some((item) => item.id === id)) || choices[0]?.id || '';
}

function harnessProviderSelect(role, selected) {
  const choices = harnessProviderChoices(role);
  const value = choices.some((item) => item.id === selected) ? selected : defaultHarnessProvider(role, choices);
  const options = choices.map((item) => `<option value="${esc(item.id)}" ${item.id === value ? 'selected' : ''}>${esc(item.label)} · ${esc(item.kind)}</option>`).join('');
  return { value, html: options || '<option value="" selected disabled>No compatible provider detected</option>' };
}

function renderLoop(host) {
  const config = loadLoopConfig();
  host.innerHTML = `<section class="task-detail">
    <div class="card-title-row"><div><span class="eyebrow">GOAL LOOP</span><h3>Research → Plan → Act → Verify → Improve</h3></div><span class="status safe">Governed</span></div>
    <p class="muted">Define the outcome once. AECP keeps the same Goal/Done/Evidence contract while the transport can evolve from Web Safe Bridge to a governed Local Autonomous worker or an official Full MCP connection.</p>
    ${executionModeCards()}
    <form id="goalLoopForm" class="provider-form">
      <div class="form-grid">
        <label class="wide">Goal<textarea id="loopGoal" rows="3" placeholder="Example: Make the application install and complete its first safe task with no technical setup required.">${esc(config.goal || '')}</textarea></label>
        <label class="wide">Definition of Done<textarea id="loopDone" rows="3" placeholder="Use measurable acceptance criteria, not 'looks good'.">${esc(config.done || '')}</textarea></label>
        <label>Maximum iterations<input id="loopIterations" type="number" min="1" max="50" value="${esc(config.maxIterations || 10)}"></label>
        <label>Checkpoint every N iterations<input id="loopCheckpoint" type="number" min="1" max="10" value="${esc(config.checkpointEvery || 2)}"></label>
        ${(() => { const p=harnessProviderSelect('planner',config.plannerProvider); return `<label>Planner<select id="harnessPlannerProvider">${p.html}</select></label><label>Planner model<input id="harnessPlannerModel" maxlength="200" value="${esc(config.plannerModel || '')}" placeholder="Optional; required for raw Ollama"></label>`; })()}
        ${(() => { const p=harnessProviderSelect('builder',config.builderProvider); return `<label>Builder<select id="harnessBuilderProvider">${p.html}</select></label><label>Builder model<input id="harnessBuilderModel" maxlength="200" value="${esc(config.builderModel || '')}" placeholder="Example: ollama/qwen3-coder:30b for OpenCode"></label>`; })()}
        ${(() => { const p=harnessProviderSelect('reviewer',config.reviewerProvider); return `<label>Reviewer<select id="harnessReviewerProvider">${p.html}</select></label><label>Reviewer model<input id="harnessReviewerModel" maxlength="200" value="${esc(config.reviewerModel || '')}" placeholder="Optional; required for raw Ollama"></label>`; })()}
      </div>
      <div class="task-actions">
        <button class="primary-button" type="button" data-action="copy-loop-prompt">Copy Goal Loop prompt</button>
        <button class="primary-button" type="button" data-action="start-harness" ${state.harnessStatus && ['PLANNING','READY','RUNNING','VERIFYING','REVIEWING','REWORK'].includes(state.harnessStatus.state) ? 'disabled' : ''}>Start Full Harness</button>
        <button class="secondary-button" type="button" data-action="cancel-harness" ${state.harnessStatus && ['PLANNING','READY','RUNNING','VERIFYING','REVIEWING','REWORK'].includes(state.harnessStatus.state) ? '' : 'disabled'}>Stop Harness</button>
        <button class="secondary-button" type="button" data-action="open-chatgpt">Open ChatGPT</button>
      </div>
    </form>
    <div class="card-title-row"><div><span class="eyebrow">HARNESS ENGINEERING</span><h3>Planner → Queue → Builder → Verify → Reviewer</h3></div><span class="status ${statusClass(state.harnessStatus?.state)}">${esc(state.harnessStatus?.state || 'IDLE')}</span></div>
    <p class="muted">This is the full bounded multi-agent loop. The Harness owns state, retries and stop conditions; workers cannot self-declare completion. Raw Ollama is Planner/Reviewer only; use OpenCode with an Ollama model or a fixed local-command worker for actual file construction.</p>
    <div class="pipeline">

      ${[
        ['RESEARCH', 'Collect only the information needed for the current uncertainty.'],
        ['PLAN', 'Choose the smallest high-value next action and state why.'],
        ['ACT', 'Use a governed capability/provider; Web mode uses an explicit Command Card.'],
        ['VERIFY', 'Use tests, evidence, diff or measurable acceptance criteria.'],
        ['REFLECT', 'Decide DONE, BLOCKED, NEEDS_APPROVAL, or NEXT_ITERATION.']
      ].map(([name, text], index) => `<div class="pipeline-step ${index === 0 ? 'active' : ''}"><div class="step-node">${index + 1}</div><div class="step-body"><strong>${name}</strong><small>${text}</small></div></div>`).join('')}
    </div>
    <div class="privacy-note"><strong>Stop conditions are part of the feature</strong><p>The loop must stop when Done is proven, iteration budget is exhausted, a required permission is missing, a high-risk action needs approval, or repeated attempts stop producing progress.</p></div>

    <section class="autonomy-card">
      <div class="card-title-row"><div><span class="eyebrow">BOUNDED AUTONOMOUS</span><h3>Let a worker build in an isolated worktree</h3></div><span class="status ${statusClass(state.autonomyStatus?.state)}">${esc(state.autonomyStatus?.state || 'IDLE')}</span></div>
      <p class="muted">AECP requires a clean Git-root Workspace, creates a detached worktree, lets the worker edit only that isolated copy, runs a fixed verifier, retries on failure, and generates a verified patch. Your real Workspace changes only after you press Apply.</p>
      <div class="form-grid">
        <label>Worker<select id="autoWorker">${(state.autonomyOptions?.workers || []).map((w) => `<option value="${esc(w.id)}" ${w.available ? '' : 'disabled'} ${w.id === state.autonomyOptions?.recommendedWorker ? 'selected' : ''}>${esc(w.label)} · ${w.available ? esc(w.version) : 'Not detected'}</option>`).join('')}</select></label>
        <label>Verifier<select id="autoVerifier">${(state.autonomyOptions?.verificationProfiles || []).map((v) => `<option value="${esc(v.id)}" ${v.id === state.autonomyOptions?.recommendedVerification ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label>Max iterations<input id="autoIterations" type="number" min="1" max="12" value="4"></label>
        <label>Timeout / iteration (sec)<input id="autoTimeout" type="number" min="30" max="1800" value="300"></label>
      </div>
      <div class="task-actions">
        <button class="primary-button" data-action="start-autonomy" type="button" ${['PREPARING','RUNNING','VERIFYING','CANCELLING'].includes(state.autonomyStatus?.state) ? 'disabled' : ''}>Start autonomous run</button>
        <button class="secondary-button" data-action="cancel-autonomy" type="button" ${['PREPARING','RUNNING','VERIFYING'].includes(state.autonomyStatus?.state) ? '' : 'disabled'}>Cancel</button>
        <button class="secondary-button" data-action="open-autonomy-worktree" type="button" ${state.autonomyStatus?.worktree ? '' : 'disabled'}>Open worktree</button>
        <button class="primary-button" data-action="apply-autonomy" type="button" ${state.autonomyStatus?.state === 'DONE' ? '' : 'disabled'}>Apply verified changes</button>
      </div>
      ${state.autonomyStatus ? `<div class="detail-grid">
        <div class="detail-cell"><small>Run</small><strong>${esc(state.autonomyStatus.id || '—')}</strong></div>
        <div class="detail-cell"><small>Iteration</small><strong>${esc(state.autonomyStatus.currentIteration || 0)} / ${esc(state.autonomyStatus.maxIterations || 0)}</strong></div>
        <div class="detail-cell"><small>Worker</small><strong>${esc(state.autonomyStatus.workerId || '—')}</strong></div>
        <div class="detail-cell"><small>Verifier</small><strong>${esc(state.autonomyStatus.verificationProfile || '—')}</strong></div>
      </div>` : ''}
    </section>
  </section>`;
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
  host.innerHTML = state.providers.map((provider) => `<div class="provider-item"><div><strong>${esc(provider.name)}</strong><small>${esc(provider.kind)} · ${esc(provider.status)}${provider.hasCredential ? ' · credential stored' : ''}${provider.defaultModel ? ` · model ${esc(provider.defaultModel)}` : ''}${provider.baseUrl ? ` · ${esc(provider.baseUrl)}` : ''}</small></div>${provider.builtIn ? '<span class="status ready">Built in</span>' : `<button class="secondary-button" data-delete-provider="${esc(provider.id)}" type="button">Remove</button>`}</div>`).join('');
}

function renderAgents() {
  const host = $('#agentList');
  if (!host) return;
  host.innerHTML = state.agents.map((agent) => `
    <div class="agent-item">
      <div>
        <strong>${esc(agent.name)}</strong>
        <small>${esc(agent.role)} · ${esc(agent.available ? agent.version : 'Not detected')}</small>
      </div>
      <button class="${agent.id === 'chatgpt-web' ? 'primary-button' : 'secondary-button'}" data-agent-id="${esc(agent.id)}" type="button" ${agent.available ? '' : 'disabled'}>${agent.id === 'chatgpt-web' ? 'Open' : 'Launch'}</button>
    </div>`).join('') || '<div class="empty-list">No agents detected.</div>';
}

function renderUpdate() {
  const badge = $('#updateBadge');
  const text = $('#updateText');
  const apply = $('#applyUpdateButton');
  const rollback = $('#rollbackUpdateButton');
  const connect = $('#connectGitHubButton');
  if (!badge || !text || !apply || !rollback || !connect) return;

  if (state.update) {
    badge.textContent = state.update.available ? 'Update available' : (state.update.connected ? 'Up to date' : 'GitHub needed');
    badge.className = `status ${state.update.available ? 'warn' : (state.update.connected ? 'ready' : 'neutral')}`;
    text.textContent = state.update.message || 'Release status checked.';
    if (state.update.latestVersion) text.textContent += ` Current v${state.update.currentVersion}; latest v${state.update.latestVersion}.`;
    apply.disabled = !state.update.available;
  } else {
    const connected = Boolean(state.githubConnection?.connected);
    badge.textContent = connected ? 'GitHub connected' : 'Not checked';
    badge.className = `status ${connected ? 'ready' : 'neutral'}`;
    text.textContent = connected
      ? 'Private GitHub is authenticated. Check Release status when you want to update.'
      : 'Connect GitHub once, then AECP can securely read private Releases and self-update from the allowlisted repository.';
    apply.disabled = true;
  }
  const tx = state.updateTransaction;
  rollback.disabled = !(tx?.state === 'ROLLBACK_REQUIRED' && tx?.rollbackInstaller && tx?.rollbackSha256);
  if (tx?.state === 'ROLLBACK_REQUIRED') {
    badge.textContent = 'Rollback required';
    badge.className = 'status bad';
    text.textContent = tx.rollbackInstaller
      ? `Update health check failed (observed ${tx.observedVersion || 'unknown'}; expected ${tx.targetVersion}). A verified rollback installer is available.`
      : `Update health check failed (observed ${tx.observedVersion || 'unknown'}; expected ${tx.targetVersion}). No verified rollback installer was retained.`;
  } else if (tx?.state === 'HEALTHY') {
    text.textContent += ` Last update to v${tx.targetVersion} passed first-boot health verification.`;
  }
  connect.textContent = state.githubConnection?.connected ? 'GitHub connected' : 'Connect GitHub';
  connect.disabled = Boolean(state.githubConnection?.connected);
}

function renderMcp() {
  const badge = $('#mcpBadge');
  const text = $('#mcpText');
  const start = $('#startMcpButton');
  const stop = $('#stopMcpButton');
  const copy = $('#copyMcpButton');
  if (!badge || !text || !start || !stop || !copy) return;
  const running = Boolean(state.mcpStatus?.running);
  badge.textContent = running ? 'Read-only running' : 'Stopped';
  badge.className = `status ${running ? 'ready' : 'neutral'}`;
  text.textContent = running
    ? `Loopback endpoint: ${state.mcpStatus.url}. Workspace-bound, bearer-protected, read-only.`
    : 'Read-only loopback MCP for supported official integrations. It binds only to 127.0.0.1 and requires a bearer token.';
  start.disabled = running || !state.data?.currentWorkspace;
  stop.disabled = !running;
  copy.disabled = !running;
}

async function startMcp() {
  toast('Starting read-only Local MCP…');
  const result = await safe(() => window.aecp.startMcp());
  if (!result) return;
  state.mcpStatus = result;
  renderMcp();
  renderControl();
  toast('Local MCP is running on loopback only.');
}

async function stopMcp() {
  const result = await safe(() => window.aecp.stopMcp());
  if (!result) return;
  state.mcpStatus = result;
  renderMcp();
  renderControl();
  toast('Local MCP stopped.');
}

async function copyMcpConnection() {
  const ok = await safe(() => window.aecp.copyMcpConnection());
  if (ok) toast('MCP connection details copied. The bearer value is a secret; paste it only into trusted tunnel/client configuration.');
}

async function launchAgent(agentId) {
  const result = await safe(() => window.aecp.launchAgent(agentId));
  if (result?.ok) toast(`${state.agents.find((item) => item.id === agentId)?.name || 'Agent'} launched.`);
}

async function checkUpdate() {
  toast('Checking the private GitHub Release channel…');
  const result = await safe(() => window.aecp.checkUpdate());
  if (!result) return;
  state.update = result;
  state.githubConnection = { connected: result.connected, ghInstalled: result.ghInstalled, message: result.message };
  renderUpdate();
  toast(result.message || 'Update check completed.', result.available ? 'info' : 'info');
}

async function connectGitHub() {
  const result = await safe(() => window.aecp.connectGitHub());
  if (!result) return;
  if (result.reason === 'GH_NOT_INSTALLED') {
    toast('GitHub CLI download page opened. Install it, then press Connect GitHub again.');
    return;
  }
  if (result.alreadyConnected) {
    toast('GitHub is already connected.');
  } else {
    toast('GitHub login opened in PowerShell. Finish the browser login, then press Check update.');
  }
  state.githubConnection = await safe(() => window.aecp.getGitHubConnection(), state.githubConnection);
  renderUpdate();
}

async function applyUpdate() {
  if (!state.update?.available) return;
  if (!confirm(`Install AECP v${state.update.latestVersion}? The installer is downloaded from the allowlisted private GitHub Release and SHA-256 verified before launch.`)) return;
  toast('Downloading and verifying the update…');
  const result = await safe(() => window.aecp.applyUpdate());
  if (result?.ok) toast('Update verified. AECP will close and install the new version.');
}

async function rollbackUpdate() {
  const tx = state.updateTransaction;
  if (!(tx?.state === 'ROLLBACK_REQUIRED' && tx?.rollbackInstaller && tx?.rollbackSha256)) return;
  if (!confirm(`Reinstall the retained, SHA-256 verified AECP v${tx.currentVersion} rollback package?`)) return;
  toast('Verifying retained rollback installer…');
  const result = await safe(() => window.aecp.rollbackUpdate());
  if (result?.ok) toast('Rollback verified. AECP will close and reinstall the previous version.');
}

async function chooseWorkspace() {
  const workspace = await safe(() => window.aecp.selectWorkspace());
  if (!workspace) return;
  state.view = 'start';
  $('#welcomeOverlay').classList.add('hidden');
  toast(`Workspace connected: ${workspace.name}`);
  await loadAll();
}

async function refreshWorkspace() {
  await safe(() => window.aecp.refreshWorkspace());
  await loadAll();
  toast('Local Workspace refreshed.');
}

async function openChatGPT() {
  const ok = await safe(() => window.aecp.openChatGPT());
  if (ok) {
    state.chatgptOpened = true;
    localStorage.setItem('aecp-chatgpt-opened', '1');
    toast('Official ChatGPT opened in your browser.');
    if (state.view === 'start') renderControl();
  }
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

async function copyGoalLoopPrompt() {
  const goal = $('#loopGoal')?.value.trim() || '';
  const done = $('#loopDone')?.value.trim() || '';
  const maxIterations = Math.max(1, Math.min(50, Number($('#loopIterations')?.value || 10)));
  const checkpointEvery = Math.max(1, Math.min(10, Number($('#loopCheckpoint')?.value || 2)));
  if (!goal || !done) {
    toast('Goal and Definition of Done are both required.', 'error');
    return;
  }
  const config = { goal, done, maxIterations, checkpointEvery };
  localStorage.setItem('aecp-goal-loop', JSON.stringify(config));
  const prompt = `AECP_GOAL_LOOP_V1\n\nYou are the reasoning supervisor for an AI Engineering Control Plane Goal Loop.\n\nGOAL\n${goal}\n\nDEFINITION OF DONE\n${done}\n\nLOOP BUDGET\nMaximum iterations: ${maxIterations}\nCheckpoint every: ${checkpointEvery} iteration(s)\n\nOPERATING CONTRACT\n1. Work in this cycle: RESEARCH -> PLAN -> ACT -> VERIFY -> REFLECT.\n2. Do not declare completion from confidence alone. Completion requires evidence against the Definition of Done.\n3. Choose the smallest high-value next action; avoid repeating an action that produced no progress.\n4. At each checkpoint summarize: progress, evidence, unresolved risks, and whether direction should change.\n5. Stop with one state only: DONE, BLOCKED, NEEDS_APPROVAL, or NEXT_ITERATION.\n6. For AECP v0.3 Web Safe Bridge, when local inspection is needed output exactly one aecp.task/v1 Command Card using only supported read-only actions (inspect-workspace or git-status). Do not invent shell/file-write privileges. Wait for the AECP Result Capsule before claiming that local action succeeded.\n7. If the goal requires a capability not available in this preview, design the next governed adapter or implementation step instead of pretending it executed.\n\nStart at iteration 1. First determine the highest-value uncertainty or action needed to move toward Done.`;
  const ok = await safe(() => window.aecp.writeClipboard(prompt));
  if (ok) toast('Goal Loop prompt copied. Paste it into ChatGPT and keep returning verified Result Capsules.');
}

async function startHarness() {
  const goal = $('#loopGoal')?.value.trim() || '';
  const done = $('#loopDone')?.value.trim() || '';
  if (!goal || !done) { toast('Goal and Definition of Done are required.', 'error'); return; }

  const plannerProvider = $('#harnessPlannerProvider')?.value || '';
  const builderProvider = $('#harnessBuilderProvider')?.value || '';
  const reviewerProvider = $('#harnessReviewerProvider')?.value || '';
  if (!plannerProvider || !builderProvider || !reviewerProvider) { toast('Planner, Builder and Reviewer providers must all be available.', 'error'); return; }

  const selectedIds = new Set([plannerProvider, builderProvider, reviewerProvider]);
  const selectedCustom = (state.providers || []).filter((provider) => selectedIds.has(provider.id));
  const needsNetwork = selectedCustom.some((provider) => ['api', 'local'].includes(provider.kind));
  const needsCredential = selectedCustom.some((provider) => provider.hasCredential);
  if (needsNetwork && !confirm('This Harness run will send prompts to the selected configured provider endpoint. Allow network access for this run?')) return;
  if (needsCredential && !confirm('This Harness run will use an OS-protected provider credential for the selected endpoint. Allow credential use for this run?')) return;

  const config = {
    goal, done,
    maxIterations: Math.max(1, Math.min(5, Number($('#loopIterations')?.value || 3))),
    checkpointEvery: Math.max(1, Math.min(10, Number($('#loopCheckpoint')?.value || 2))),
    plannerProvider, builderProvider, reviewerProvider,
    plannerModel: $('#harnessPlannerModel')?.value.trim() || '',
    builderModel: $('#harnessBuilderModel')?.value.trim() || '',
    reviewerModel: $('#harnessReviewerModel')?.value.trim() || ''
  };
  localStorage.setItem('aecp-goal-loop', JSON.stringify(config));

  const result = await safe(() => window.aecp.startHarness({
    goal, done, maxTasks: 4, maxIterations: config.maxIterations,
    plannerProvider, builderProvider, reviewerProvider,
    plannerModel: config.plannerModel || null,
    builderModel: config.builderModel || null,
    reviewerModel: config.reviewerModel || null,
    providerNetworkApproved: needsNetwork,
    providerCredentialApproved: needsCredential,
    context: 'Use the current AECP Workspace and its Blueprint as engineering constraints.'
  }));
  if (!result) return;
  state.harnessStatus = result;
  renderControl();
  toast('Full Harness started with explicit Planner / Builder / Reviewer routing.');
}
async function cancelHarness() {
  const result = await safe(() => window.aecp.cancelHarness());
  if (result) { state.harnessStatus = result; renderControl(); toast('Harness cancellation requested.'); }
}

async function startAutonomy() {
  const goal = $('#loopGoal')?.value.trim() || '';
  const done = $('#loopDone')?.value.trim() || '';
  const workerId = $('#autoWorker')?.value || 'opencode';
  const verificationProfile = $('#autoVerifier')?.value || 'npm-test';
  const maxIterations = Number($('#autoIterations')?.value || 4);
  const iterationTimeoutSeconds = Number($('#autoTimeout')?.value || 300);
  if (!goal || !done) { toast('Goal and Definition of Done are required.', 'error'); return; }
  const repo = state.data?.currentWorkspace?.repositories?.find((item) => item.path === state.data.currentWorkspace.rootPath);
  if (!repo) { toast('Autonomous mode currently requires the Workspace itself to be a Git repository root.', 'error'); return; }
  if (repo.dirty) { toast('Commit/stash/discard current changes first. Autonomous mode requires a clean Workspace.', 'error'); return; }
  const result = await safe(() => window.aecp.startAutonomy({ goal, done, workerId, verificationProfile, maxIterations, iterationTimeoutSeconds, checkpointEvery: 1 }));
  if (!result) return;
  state.autonomyStatus = result;
  renderControl();
  toast('Bounded autonomous run started in an isolated worktree.');
}

async function cancelAutonomy() {
  const result = await safe(() => window.aecp.cancelAutonomy());
  if (result) { state.autonomyStatus = result; renderControl(); toast('Cancellation requested.'); }
}

async function openAutonomyWorktree() {
  await safe(() => window.aecp.openAutonomyWorktree());
}

async function applyAutonomy() {
  if (!confirm('Apply the verified autonomous patch to your real Workspace? AECP will first require the Workspace to still be clean and at the same Git HEAD.')) return;
  const result = await safe(() => window.aecp.applyAutonomy());
  if (!result) return;
  state.autonomyStatus = result;
  await safe(() => window.aecp.refreshWorkspace());
  await loadAll();
  toast(result.state === 'APPLIED' ? 'Verified changes applied to the Workspace. They remain uncommitted for your review.' : 'No patch changes needed.');
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
  $('#openChatGPTButton').addEventListener('click', openChatGPT);
  $('#startMcpButton').addEventListener('click', startMcp);
  $('#stopMcpButton').addEventListener('click', stopMcp);
  $('#copyMcpButton').addEventListener('click', copyMcpConnection);
  $('#checkUpdateButton').addEventListener('click', checkUpdate);
  $('#applyUpdateButton').addEventListener('click', applyUpdate);
  $('#rollbackUpdateButton').addEventListener('click', rollbackUpdate);
  $('#connectGitHubButton').addEventListener('click', connectGitHub);
  $('#openReleasesButton').addEventListener('click', () => safe(() => window.aecp.openReleases()));
  $('#importClipboardButton').addEventListener('click', importFromClipboard);
  $('#sampleButton').addEventListener('click', createSampleTask);
  $('#modeButton').addEventListener('click', () => { state.engineering = !state.engineering; if (!state.engineering && state.view === 'trace') state.view = 'start'; render(); });
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
      defaultModel: $('#providerModelInput').value,
      command: $('#providerCommandInput').value,
      args: $('#providerArgsInput').value,
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
      if (action === 'open-chatgpt') await openChatGPT();
      if (action === 'sample-task') await createSampleTask();
      if (action === 'show-loop') setView('loop');
      if (action === 'copy-loop-prompt') await copyGoalLoopPrompt();
      if (action === 'start-autonomy') await startAutonomy();
      if (action === 'start-harness') await startHarness();
      if (action === 'cancel-harness') await cancelHarness();
      if (action === 'cancel-autonomy') await cancelAutonomy();
      if (action === 'open-autonomy-worktree') await openAutonomyWorktree();
      if (action === 'apply-autonomy') await applyAutonomy();
      if (action === 'run-task') await runTask(taskId);
      if (action === 'copy-result') await copyResult(taskId);
      if (action === 'show-evidence') { state.selectedTaskId = taskId; setView('evidence'); }
      return;
    }
    const agentNode = event.target.closest('[data-agent-id]');
    if (agentNode) {
      await launchAgent(agentNode.dataset.agentId);
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

  window.aecp.onAutonomyEvent(async (event) => {
    state.autonomyStatus = await safe(() => window.aecp.getAutonomyStatus(), state.autonomyStatus);
    if (state.view === 'loop') renderControl();
    if (event?.type === 'run.done') toast('Autonomous verification passed. Review the worktree or Apply verified changes.');
    if (event?.type === 'run.budget_exhausted') toast('Iteration budget exhausted. Nothing was applied to the real Workspace.', 'error');
    if (event?.type === 'run.failed') toast(event?.data?.error || 'Autonomous run failed.', 'error');
    if (event?.type === 'run.cancelled') toast('Autonomous run cancelled. Nothing was applied.');
  });
  window.aecp.onHarnessEvent(async (event) => {
    state.harnessStatus = await safe(() => window.aecp.getHarnessStatus(), state.harnessStatus);
    if (state.view === 'loop' || state.view === 'board' || state.view === 'pipeline') renderControl();
    if (event?.type === 'task.accepted') toast(`Harness accepted ${event?.data?.taskId || 'task'}.`);
    if (event?.type === 'harness.final' && event?.state === 'DONE') toast('Full Harness completed and produced a verified patch.');
  });

}

async function boot() {
  bindEvents();
  await loadAll();
}

boot();
