'use strict';

const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: light)');
const themeController = window.AECPTheme.createThemeController({ storage: window.localStorage, media: systemThemeMedia });

const state = {
  app: null,
  data: null,
  tools: [],
  tasks: [],
  providers: [],
  agents: [],
  agentSettings: null,
  agentDraft: {},
  agentOpen: {},
  sayHi: {},
  sayHiBusy: {},
  browserWindows: [],
  githubConnection: null,
  update: null,
  updateTransaction: null,
  mcpStatus: null,
  autonomyOptions: null,
  autonomyStatus: null,
  harnessStatus: null,
  guidance: null,
  policyInfo: null,
  adapterMatrix: null,
  selectedTaskId: null,
  view: 'start',
  engineering: false,
  theme: themeController.theme,
  motion: ['system', 'reduced'].includes(localStorage.getItem('aecp-motion')) ? localStorage.getItem('aecp-motion') : 'system',
  chatgptOpened: localStorage.getItem('aecp-chatgpt-opened') === '1'
};

const $ = (selector) => document.querySelector(selector);
const selectAll = (selector) => [...document.querySelectorAll(selector)];
const tr = (key, fallback = '') => window.AECPI18N?.t(key, fallback) || fallback || key;
// Native confirmation dialogs are shown in the current language too.
const confirmText = (message) => window.confirm(window.AECPI18N?.tx ? window.AECPI18N.tx(message) : message);
let providerFocusReturn = null;

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

function formatProviderUsage(summary, managedExternally = false) {
  if (managedExternally) return 'subscription-managed externally';
  if (!summary?.requests) return 'no recorded invocations';
  const totals = summary.numericTotals || {};
  const totalTokens = Object.entries(totals)
    .filter(([key]) => /(?:^|\.)total_tokens$/i.test(key))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const costs = Object.entries(totals)
    .filter(([key]) => /(?:^|\.)(?:cost|total_cost|cost_usd)$/i.test(key))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const bits = [
    `${summary.requests} requests`,
    `${summary.successes || 0} ok / ${summary.failures || 0} failed`,
    `avg ${Math.round(summary.averageLatencyMs || 0)} ms`
  ];
  if (totalTokens > 0) bits.push(`${Math.round(totalTokens)} total tokens`);
  if (costs > 0) bits.push(`reported cost ${costs.toFixed(4)}`);
  return bits.join(' · ');
}

function resolvedTheme() {
  return themeController.resolved();
}

function cycleTheme() {
  state.theme = themeController.cycle();
  render();
}

function statusClass(value) {
  if (['DONE', 'PASS', 'READY', 'APPLIED'].includes(value)) return 'ready';
  if (['FAILED', 'BLOCKED', 'BUDGET_EXHAUSTED', 'CANCELLED', 'INTERRUPTED', 'UNAVAILABLE'].includes(value)) return 'bad';
  if (['PREPARING', 'RUNNING', 'VERIFYING', 'WAITING_USER', 'CANCELLING', 'DEGRADED', 'AUTH_REQUIRED'].includes(value)) return 'warn';
  return 'neutral';
}

async function loadAll() {
  const [app, data, tools, tasks, providers, agents, browserWindows, githubConnection, updateTransaction, mcpStatus, autonomyOptions, autonomyStatus, harnessStatus, guidance, agentSettings] = await Promise.all([
    safe(() => window.aecp.getAppInfo()),
    safe(() => window.aecp.getState()),
    safe(() => window.aecp.detectTools(), []),
    safe(() => window.aecp.listTasks(), []),
    safe(() => window.aecp.listProviders(), []),
    safe(() => window.aecp.listAgents(), []),
    safe(() => window.aecp.listBrowserWindows(), []),
    safe(() => window.aecp.getGitHubConnection(), null),
    safe(() => window.aecp.getUpdateStatus(), null),
    safe(() => window.aecp.getMcpStatus(), null),
    safe(() => window.aecp.getAutonomyOptions(), null),
    safe(() => window.aecp.getAutonomyStatus(), null),
    safe(() => window.aecp.getHarnessStatus(), null),
    safe(() => window.aecp.getGuidance({ chatgptOpened: state.chatgptOpened }), null),
    safe(() => window.aecp.getAgentSettings?.(), null)
  ]);
  state.app = app;
  state.agentSettings = agentSettings && Array.isArray(agentSettings.agents) ? agentSettings : null;
  for (const warning of app?.startupWarnings || []) toast(`Started with a repaired file: ${warning.file} was unreadable${warning.quarantinedAs ? ` and was kept as ${warning.quarantinedAs}` : ''}. Its feature restarted from empty state.`, 'error');
  state.data = data;
  state.tools = tools || [];
  state.tasks = tasks || [];
  state.providers = providers || [];
  state.agents = agents || [];
  state.browserWindows = browserWindows || [];
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
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.motion = state.motion;
  $('#themeButton').setAttribute('aria-label', `Theme: ${state.theme}`);
  $('#themeButton').title = `Theme: ${state.theme}`;
  document.body.classList.toggle('engineering-mode', state.engineering);
  $('#modeButton').dataset.i18n = state.engineering ? 'mode.engineering' : 'mode.beginner';
  $('#modeButton').textContent = tr(state.engineering ? 'mode.engineering' : 'mode.beginner', state.engineering ? 'Engineering' : 'Beginner');
  $('#versionText').textContent = state.app ? `v${state.app.version} · ${state.app.arch}` : 'Preview';
  renderWorkspace();
  renderTools();
  renderProviders();
  renderAgents();
  renderBrowserDock();
  renderUpdate();
  renderMcp();
  renderTabs();
  renderControl();
  $('#welcomeOverlay').classList.toggle('hidden', Boolean(state.data?.currentWorkspace));
  window.AECPI18N?.apply(document);
}

function renderWorkspace() {
  const workspace = state.data?.currentWorkspace;
  $('#workspaceName').textContent = workspace?.name || tr('workspace.choose','Choose Workspace');
  $('#workspacePath').textContent = workspace?.rootPath || 'Choose the folder AECP is allowed to inspect.';
  $('#workspaceState').textContent = workspace ? tr('workspace.bound','Bound') : tr('workspace.notSet','Not set');
  $('#workspaceState').className = `status ${workspace ? 'ready' : 'neutral'}`;
  $('#workspaceButton .dot').className = `dot ${workspace ? 'ready' : 'idle'}`;
  $('#openWorkspaceButton').disabled = !workspace;
  $('#terminalButton').disabled = !workspace;
  $('#addRepoButton').disabled = !workspace;

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
  selectAll('.view-tab').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  const names = {
    start: ['start','Start'],
    command: ['harness','Harness'],
    board: ['taskBoard','Task Board'],
    pipeline: ['taskPipeline','Task Pipeline'],
    loop: ['goalLoop','Goal Loop'],
    graph: ['workspaceGraph','Workspace Graph'],
    trace: ['executionTrace','Execution Trace'],
    evidence: ['evidence','Evidence']
  };
  const selected = names[state.view];
  $('#controlTitle').textContent = selected ? tr(selected[0],selected[1]) : tr('controlPlane.title','Control Plane');
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
    provider.kind === 'remote-mcp' && ['DEGRADED', 'READY'].includes(provider.status)
  );
  const remoteMcpEndpointHealthy = remoteMcp?.status === 'READY';
  const localMcpRunning = Boolean(state.mcpStatus?.running);
  // A reachable MCP endpoint is not proof that an official ChatGPT workspace/tunnel,
  // policy-gated write tool, and same-task result path all work end-to-end.
  // Until that external/product acceptance gate is completed, E3 must remain not-ready.
  const officialMcpReady = false;
  const recommended = localWorkers.length ? 'local-autonomous' : 'web-safe';
  return { localWorkers, remoteMcp, remoteMcpEndpointHealthy, localMcpRunning, officialMcpReady, recommended };
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
      ready: status.officialMcpReady,
      detail: status.remoteMcpEndpointHealthy
        ? 'Remote MCP endpoint health passed, but Official Full MCP is still externally gated until a supported ChatGPT workspace/tunnel, policy-gated write tool, same-task result return, disconnect fallback, and no-DOM-automation checks all pass end-to-end.'
        : (status.remoteMcp
          ? 'Remote MCP endpoint is configured but has not passed endpoint health. Official Full MCP also requires separate end-to-end ChatGPT connector/tunnel acceptance.'
          : (status.localMcpRunning
            ? 'Local MCP is running read-only. This alone never makes Official Full MCP ready; a supported ChatGPT app/tunnel and full end-to-end acceptance are still required.'
            : 'External verification required: supported ChatGPT workspace/tunnel + read/write policy + same-task result flow. No ChatGPT DOM scraping.'))
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

const LOOP_PRESETS = Object.freeze({
  research: {
    label: 'Research',
    goal: 'Research the stated engineering question, compare alternatives, identify uncertainty, and produce evidence-backed findings.',
    done: 'Decision criteria are explicitly answered, material alternatives are compared, uncertainties are recorded, and each conclusion is supported by evidence.',
    maxIterations: 8,
    checkpointEvery: 2
  },
  build: {
    label: 'Build',
    goal: 'Implement the requested engineering change through inspect → plan → edit → build → test → review.',
    done: 'The requested behavior is implemented, deterministic verification passes, evidence is recorded, and no unresolved acceptance criterion remains.',
    maxIterations: 6,
    checkpointEvery: 1
  },
  debug: {
    label: 'Debug',
    goal: 'Reproduce the failure, form and test bounded hypotheses, change one variable at a time, and preserve diagnostic evidence.',
    done: 'The root cause is demonstrated, the fix is verified against the reproduction, regression coverage exists, and relevant evidence is preserved.',
    maxIterations: 8,
    checkpointEvery: 1
  },
  review: {
    label: 'Review',
    goal: 'Review the current change for correctness, architecture, security, accessibility, and regression risk.',
    done: 'Diff and tests are inspected, material findings are resolved or explicitly gated, and the reviewer returns PASS, REWORK, or HUMAN_REQUIRED with evidence.',
    maxIterations: 4,
    checkpointEvery: 1
  },
  optimization: {
    label: 'Optimization',
    goal: 'Establish a measurable baseline, propose bounded improvements, benchmark them, and retain only verified gains.',
    done: 'The target metric is reached or the budget is exhausted; retained changes show measurable improvement without violating correctness or policy constraints.',
    maxIterations: 8,
    checkpointEvery: 2
  },
  release: {
    label: 'Release',
    goal: 'Prepare the current source for release through version verification, test matrix, packaging, integrity/provenance checks, and governed publication gates.',
    done: 'Required CI/package evidence passes on the exact source commit, release artifacts and hashes/provenance are complete, and any signing/Store/publish owner gates are explicitly satisfied or HUMAN_REQUIRED.',
    maxIterations: 5,
    checkpointEvery: 1
  }
});

function applyLoopPreset(id) {
  const preset = LOOP_PRESETS[id];
  if (!preset) return false;
  const current = loadLoopConfig();
  const next = {
    ...current,
    preset: id,
    goal: preset.goal,
    done: preset.done,
    maxIterations: preset.maxIterations,
    checkpointEvery: preset.checkpointEvery
  };
  localStorage.setItem('aecp-goal-loop', JSON.stringify(next));
  const setValue = (selector, value) => { const node = $(selector); if (node) node.value = String(value); };
  setValue('#loopGoal', next.goal);
  setValue('#loopDone', next.done);
  setValue('#loopIterations', next.maxIterations);
  setValue('#loopCheckpoint', next.checkpointEvery);
  return true;
}

const HARNESS_AGENT_PROVIDER = Object.freeze({
  'claude-code': { id: 'claude', roles: ['planner', 'reviewer'], network: true },
  'codex-cli': { id: 'codex', roles: ['builder'], network: false },
  'gemini-cli': { id: 'gemini', roles: ['planner', 'reviewer'], network: true },
  'opencode': { id: 'opencode', roles: ['planner', 'builder', 'reviewer'], network: true },
  'ollama': { id: 'ollama', roles: ['planner', 'reviewer'], network: false }
});

function harnessProviderChoices(role) {
  const choices = [];
  for (const agent of state.agents || []) {
    const mapped = HARNESS_AGENT_PROVIDER[agent.id];
    if (!mapped || !mapped.roles.includes(role) || !agent.available) continue;
    choices.push({ id: mapped.id, label: agent.name, kind: agent.kind || 'cli', hasCredential: false, network: Boolean(mapped.network) });
  }
  for (const provider of state.providers || []) {
    if (!provider || provider.id === 'chatgpt-web' || provider.kind === 'remote-mcp') continue;
    if (!Array.isArray(provider.roles) || !provider.roles.includes(role)) continue;
    choices.push({ id: provider.id, label: provider.name, kind: provider.kind, hasCredential: Boolean(provider.hasCredential), defaultModel: provider.defaultModel || '', network: ['api','local'].includes(provider.kind) });
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
      <div class="task-actions loop-presets" role="group" aria-label="Goal Loop presets">
        ${Object.entries(LOOP_PRESETS).map(([id,preset]) => `<button class="secondary-button" type="button" data-action="apply-loop-preset" data-preset="${esc(id)}">${esc(preset.label)}</button>`).join('')}
      </div>
      <div class="form-grid">
        <label class="wide">Goal<textarea id="loopGoal" rows="3" placeholder="Example: Make the application install and complete its first safe task with no technical setup required.">${esc(config.goal || '')}</textarea></label>
        <label class="wide">Definition of Done<textarea id="loopDone" rows="3" placeholder="Use measurable acceptance criteria, not 'looks good'.">${esc(config.done || '')}</textarea></label>
        <label>Maximum iterations<input id="loopIterations" type="number" min="1" max="50" value="${esc(config.maxIterations || 10)}"></label>
        <label>Maximum agent/tool turns<input id="loopTurns" type="number" min="1" max="200" value="${esc(config.maxTurns || 20)}"></label>
        <label>Maximum failed attempts<input id="loopFailures" type="number" min="1" max="20" value="${esc(config.maxFailedAttempts || 8)}"></label>
        <label>Wall-clock minutes (optional)<input id="loopWallMinutes" type="number" min="1" max="1440" value="${esc(config.maxWallClockMinutes || '')}" placeholder="No limit"></label>
        <label>Provider-reported cost (optional)<input id="loopProviderCost" type="number" min="0.000001" step="0.000001" value="${esc(config.maxProviderReportedCost || '')}" placeholder="No limit"></label>
        <label>Local compute minutes (optional)<input id="loopLocalComputeMinutes" type="number" min="1" max="1440" value="${esc(config.maxLocalComputeMinutes || '')}" placeholder="No limit"></label>
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
        <button class="secondary-button" data-action="resume-autonomy" type="button" ${state.autonomyStatus?.state === 'INTERRUPTED' && state.autonomyStatus?.spec ? '' : 'disabled'}>Resume interrupted run</button>
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
    <div class="graph-center"><div class="graph-node"><strong>${esc(workspace.name)}</strong><small>WORKSPACE · policy boundary</small><div class="task-actions"><button class="secondary-button engineering-only" type="button" data-action="edit-workspace-policy">Edit policy edge</button></div></div></div>
    <div class="graph-branches">
      <div class="graph-branch"><div class="graph-branch-label">REPOSITORIES</div><div class="task-actions"><button class="secondary-button engineering-only" type="button" data-action="add-repository-edge">Add repository binding</button></div>${repos.map((repo) => `<div class="graph-node"><strong>${esc(repo.name)}</strong><small>${esc(repo.branch)} · ${repo.dirty ? 'dirty' : 'clean'}</small></div>`).join('') || '<div class="graph-node"><strong>None</strong><small>No repository detected</small></div>'}</div>
      <div class="graph-branch"><div class="graph-branch-label">PROVIDERS</div><div class="task-actions"><button class="secondary-button engineering-only" type="button" data-action="manage-provider-edges">Manage provider bindings</button></div>${providers.map((provider) => `<div class="graph-node"><strong>${esc(provider.name)}</strong><small>${esc(provider.kind)} · ${esc(provider.status)}</small></div>`).join('')}</div>
      <div class="graph-branch"><div class="graph-branch-label">LOCAL TOOLS</div>${tools.slice(0, 8).map((tool) => `<div class="graph-node"><strong>${esc(tool.name)}</strong><small>${esc(tool.version)}</small></div>`).join('') || '<div class="graph-node"><strong>Detecting</strong><small>No tools available</small></div>'}</div>
    </div>
    <div class="privacy-note"><strong>Graph mutations are governed</strong><p>Editing a binding routes through validated Workspace, Provider, or Policy commands. The graph itself cannot grant permissions.</p></div>
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
  host.innerHTML = state.providers.map((provider) => {
    const detail = provider.healthDetail ? `<small>${esc(provider.healthDetail)}</small>` : '';
    const usage = `<small>${esc(formatProviderUsage(provider.usage, provider.usageManagedExternally))}</small>`;
    const login = provider.id === 'openai-official' ? `<button class="secondary-button" data-worker-login-official type="button">Sign in isolated OFFICIAL</button>` : '';
    const controls = `<div class="task-actions"><button class="secondary-button" data-provider-health="${esc(provider.id)}" type="button">Check health</button>${login}${provider.builtIn ? '' : `<button class="secondary-button" data-delete-provider="${esc(provider.id)}" type="button">Remove</button>`}</div>`;
    return `<div class="provider-item"><div><strong>${esc(provider.name)}</strong><small>${esc(provider.kind)} · <span class="status ${statusClass(provider.status)}">${esc(provider.status)}</span>${provider.hasCredential ? ' · credential stored' : ''}${provider.defaultModel ? ` · model ${esc(provider.defaultModel)}` : ''}${provider.baseUrl ? ` · ${esc(provider.baseUrl)}` : ''}</small>${usage}${detail}</div>${controls}</div>`;
  }).join('');
}

function renderPolicySettings() {
  const info = state.policyInfo;
  const list = $('#policyActionList');
  const maxRisk = $('#policyMaxRisk');
  if (!list || !maxRisk) return;
  if (!info?.workspaceId) {
    maxRisk.value = 'YELLOW';
    maxRisk.disabled = true;
    $('#savePolicyButton').disabled = true;
    list.innerHTML = '<div class="empty-list">Choose a Workspace before editing policy.</div>';
    return;
  }
  maxRisk.disabled = false;
  $('#savePolicyButton').disabled = false;
  maxRisk.value = info.policy?.maxRisk || 'YELLOW';
  const required = new Set(info.policy?.requireApprovalFor || []);
  list.innerHTML = (info.actions || []).map((item) => {
    const forced = Boolean(item.alwaysApproval);
    const checked = forced || required.has(item.action);
    return `<label class="provider-item"><div><strong>${esc(item.action)}</strong><small>Risk: ${esc(item.risk)}${forced ? ' · always requires approval' : ' · require approval before execution'}</small></div><input type="checkbox" data-policy-action="${esc(item.action)}" ${checked ? 'checked' : ''} ${forced ? 'disabled aria-disabled="true"' : ''}></label>`;
  }).join('');
}

function renderAdapterMatrix() {
  const matrix = state.adapterMatrix;
  const host = $('#adapterMatrix');
  const badge = $('#adapterMatrixBadge');
  if (!host || !badge) return;
  if (!matrix) {
    badge.textContent = 'Unavailable';
    badge.className = 'status bad';
    host.innerHTML = '<div class="empty-list">Adapter audit is unavailable.</div>';
    return;
  }
  badge.textContent = matrix.ok ? 'Verified' : 'Audit failed';
  badge.className = `status ${matrix.ok ? 'ready' : 'bad'}`;
  const caps = matrix.capabilities || [];
  host.innerHTML = (matrix.adapters || []).map((adapter) =>
    `<article class="provider-item"><div><strong>${esc(adapter.id)}</strong><small>${esc(adapter.kind)} · ${caps.map((cap) => `${esc(cap)}=${esc(adapter.capabilities?.[cap] || 'MISSING')}`).join(' · ')}</small></div></article>`
  ).join('') || '<div class="empty-list">No adapters reported.</div>';
}

async function refreshEngineeringSettings() {
  const [policyInfo, adapterMatrix] = await Promise.all([
    safe(() => window.aecp.getWorkspacePolicy(), null),
    safe(() => window.aecp.getAdapterCapabilityMatrix(), null)
  ]);
  state.policyInfo = policyInfo;
  state.adapterMatrix = adapterMatrix;
  renderPolicySettings();
  renderAdapterMatrix();
}

async function saveWorkspacePolicySettings() {
  if (!state.policyInfo?.workspaceId) return;
  const requireApprovalFor = selectAll('[data-policy-action]')
    .filter((node) => node.checked)
    .map((node) => node.dataset.policyAction);
  const saved = await safe(() => window.aecp.saveWorkspacePolicy({
    maxRisk: $('#policyMaxRisk').value,
    requireApprovalFor
  }), null);
  if (!saved) return;
  state.policyInfo = saved;
  renderPolicySettings();
  toast('Workspace policy saved. Future execution will use these approval rules.');
}

// ---- Per-agent model / effort settings and the "say hi" panel (work order 0019). Nothing is drawn until the settings load. ----
const agentSettingsRow = (id) => state.agentSettings?.agents?.find((item) => item.id === id) || null;

function agentSayHiResultHtml(id) {
  const result = state.sayHi[id];
  if (state.sayHiBusy[id]) return '<div class="agent-result" data-agent-result="' + esc(id) + '" aria-live="polite"><small>Waiting for the answer…</small></div>';
  if (!result) return '<div class="agent-result" data-agent-result="' + esc(id) + '" aria-live="polite"></div>';
  const seconds = (Number(result.durationMs || 0) / 1000).toFixed(1);
  return '<div class="agent-result ' + (result.ok ? 'ok' : 'failed') + '" data-agent-result="' + esc(id) + '" aria-live="polite">'
    + '<strong>' + esc(result.agentName || id) + '</strong> <span class="status ' + (result.ok ? 'ready' : 'bad') + '">' + (result.ok ? 'Succeeded' : 'Failed') + '</span>'
    + '<small>Model</small> <code>' + esc(result.model || '—') + '</code> <small>Time</small> <code>' + esc(seconds) + ' s</code>'
    + (result.ok ? '<p class="agent-reply">' + esc(result.reply) + '</p>' : '<p class="agent-reason"><small>Reason</small> ' + esc(result.reason || '') + '</p>')
    + '</div>';
}

const CUSTOM_MODEL_VALUE = '__custom__';

function agentPanelHtml(id, agent) {
  const row = agentSettingsRow(id);
  if (!row) return '';
  if (row.controllable === false) {
    return '<p class="muted agent-note" data-agent-note="' + esc(id) + '">Model and effort are chosen on the ChatGPT website itself (AIECP does not control the official website).</p>';
  }
  const draft = state.agentDraft[id] || {};
  const model = draft.model ?? row.model ?? '';
  const effort = draft.effort ?? row.effort ?? '';
  const ollamaModels = id === 'ollama' ? (state.agentSettings.ollamaModels || []) : null;
  // Officially maintained known-model lists (Claude Code's aliases; work order 0021): a fixed dropdown plus an
  // explicit "Custom…" choice that reveals a free-text field, so an existing exact model name is never lost.
  const knownModels = ollamaModels ? null : (Array.isArray(row.knownModels) ? row.knownModels : null);
  const isCustomModel = Boolean(knownModels) && (Boolean(draft.modelCustom) || (Boolean(model) && !knownModels.includes(model)));
  const modelField = ollamaModels
    ? '<select data-agent-model="' + esc(id) + '"><option value="">Use the default</option>'
      + [...new Set([...ollamaModels, ...(model ? [model] : [])])].map((name) => '<option value="' + esc(name) + '"' + (name === model ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select>'
    : knownModels
    ? '<select data-agent-model="' + esc(id) + '"><option value="">Use the default</option>'
      + knownModels.map((name) => '<option value="' + esc(name) + '"' + (!isCustomModel && name === model ? ' selected' : '') + '>' + esc(name) + '</option>').join('')
      + '<option value="' + CUSTOM_MODEL_VALUE + '"' + (isCustomModel ? ' selected' : '') + '>Custom…</option></select>'
      + (isCustomModel ? '<input data-agent-model="' + esc(id) + '" type="text" maxlength="120" value="' + esc(model) + '" placeholder="Type the exact model name">' : '')
    : '<input data-agent-model="' + esc(id) + '" type="text" maxlength="120" value="' + esc(model) + '" placeholder="Use the default">';
  // `opencode models` could not be read this time (not installed, timed out, or unparsable): the card still works
  // as a plain text field instead of breaking, and says why there is no dropdown.
  const knownModelsNote = row.knownModelsUnavailable
    ? '<small class="muted">' + esc(id === 'gemini-cli'
      ? 'This tool has no auto-detectable model list; please type it manually.'
      : 'Could not read the model list; please type it manually.') + '</small>'
    : '';
  const effortLabel = id === 'ollama' ? 'Thinking' : 'Reasoning effort';
  const effortField = row.effortSupported
    ? '<select data-agent-effort="' + esc(id) + '"><option value="">' + (id === 'ollama' ? 'Off' : 'Use the default') + '</option>'
      + row.efforts.map((name) => '<option value="' + esc(name) + '"' + (name === effort ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select>'
    : '<span class="muted">Not applicable</span>';
  const source = { settings: 'Your setting', env: 'Environment variable', provider: 'Provider entry', default: 'Use the default (chosen by the tool)' }[row.modelSource] || 'Use the default (chosen by the tool)';
  const needsModelFirst = id === 'codex-official' && !model;
  const canSayHi = row.sayHi?.supported && agent?.available !== false && row.sayHi.keyConfigured !== false && !needsModelFirst;
  const sayHiNote = !row.sayHi?.supported
    ? (id === 'codex-cli' ? 'Use the Codex OFFICIAL or Codex PEGA cards for Codex.' : 'Open this tool in a terminal yourself.')
    : (row.sayHi.keyConfigured === false ? 'The PEGA key is not set yet.'
      : needsModelFirst ? 'Choose an OFFICIAL model first.'
      : (row.sayHi.network ? 'Connects to the network and uses your account quota.' : 'Runs locally.'));
  return '<details class="agent-settings" data-agent-settings="' + esc(id) + '"' + (state.agentOpen[id] || state.sayHi[id] ? ' open' : '') + '>'
    + '<summary>Model and effort</summary>'
    + '<div class="agent-settings-body">'
    + '<small class="agent-effective">Model <code>' + esc(row.model || '—') + '</code> · ' + esc(source) + '</small>'
    + '<label>Model' + modelField + '</label>'
    + (knownModels && id === 'claude-code' ? '<small class="muted">' + esc('sonnet/opus/fable are official aliases that always resolve to the latest version; choose "Custom…" to name an exact model.') + '</small>' : '')
    + knownModelsNote
    + '<label>' + effortLabel + effortField + '</label>'
    + '<div class="button-row"><button class="secondary-button" type="button" data-agent-save="' + esc(id) + '">Save settings</button>'
    + (row.sayHi?.supported ? '<button class="primary-button" type="button" data-agent-sayhi="' + esc(id) + '" ' + (canSayHi && !state.sayHiBusy[id] ? '' : 'disabled') + '>Say hi</button>' : '') + '</div>'
    + '<small class="muted agent-sayhi-note">' + sayHiNote + '</small>'
    + agentSayHiResultHtml(id)
    + '</div></details>';
}

function renderAgents() {
  const host = $('#agentList');
  if (!host) return;
  const workers = (state.agentSettings?.agents || []).filter((item) => item.kind === 'codex-worker');
  const workerCards = workers.map((worker) => `
    <div class="agent-item">
      <div>
        <strong>${esc(worker.name)}</strong>
        <small>codex-worker · ${esc(worker.modelSource === 'default' ? 'Use the default (chosen by the tool)' : worker.model)}</small>
      </div>
    </div>${agentPanelHtml(worker.id, null)}`).join('');
  host.innerHTML = state.agents.map((agent) => `
    <div class="agent-item">
      <div>
        <strong>${esc(agent.name)}</strong>
        <small>${esc(agent.role)} · ${esc(agent.available ? agent.version : 'Not detected')}</small>
        <small>${esc(formatProviderUsage(agent.usage, agent.usageManagedExternally))}</small>
      </div>
      <button class="${agent.id === 'chatgpt-web' ? 'primary-button' : 'secondary-button'}" data-agent-id="${esc(agent.id)}" type="button" ${agent.available ? '' : 'disabled'}>${agent.id === 'chatgpt-web' ? 'Open' : 'Launch'}</button>
    </div>${agentPanelHtml(agent.id, agent)}`).join('') + workerCards || '<div class="empty-list">No agents detected.</div>';
}

function renderBrowserDock() {
  const select = $('#browserWindowSelect');
  const left = $('#dockBrowserLeftButton');
  const right = $('#dockBrowserRightButton');
  if (!select || !left || !right) return;
  const prior = select.value;
  const windows = state.browserWindows || [];
  select.innerHTML = windows.length
    ? windows.map((item) => `<option value="${esc(item.pid)}">${esc(item.process)} · PID ${esc(item.pid)}</option>`).join('')
    : '<option value="">No allowlisted browser window detected</option>';
  if (prior && windows.some((item) => String(item.pid) === prior)) select.value = prior;
  const enabled = Boolean(select.value);
  left.disabled = !enabled;
  right.disabled = !enabled;
  let lastSide = null;
  try { lastSide = localStorage.getItem('aecp-dock-side'); } catch { /* preference only */ }
  left.setAttribute('aria-pressed', String(lastSide === 'left'));
  right.setAttribute('aria-pressed', String(lastSide === 'right'));
}

async function refreshBrowserWindows() {
  state.browserWindows = await safe(() => window.aecp.listBrowserWindows(), []);
  renderBrowserDock();
}

async function dockBrowser(side) {
  try { localStorage.setItem('aecp-dock-side', side); } catch { /* preference only */ }
  const pid = Number($('#browserWindowSelect')?.value || 0);
  if (!pid) { toast('Detect and choose a browser window first.', 'error'); return; }
  const result = await safe(() => window.aecp.dockBrowserWindow(pid, side));
  if (result?.ok) toast(`Browser window docked ${side}.`);
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

async function saveAgentSettings(agentId) {
  const draft = state.agentDraft[agentId] || {};
  const row = agentSettingsRow(agentId);
  if (!row) return;
  const patch = { model: draft.model ?? row.model ?? '' };
  if (row.effortSupported) patch.effort = draft.effort ?? row.effort ?? '';
  const result = await safe(() => window.aecp.setAgentSettings(agentId, patch), null);
  if (!result) return;
  state.agentSettings = result;
  delete state.agentDraft[agentId];
  toast('Agent settings saved.');
  renderAgents();
}

// The button press is the authorization for this one fixed greeting; there is no text field.
async function sayHiToAgent(agentId) {
  if (state.sayHiBusy[agentId]) return;
  const row = agentSettingsRow(agentId);
  const draft = state.agentDraft[agentId] || {};
  state.sayHiBusy[agentId] = true;
  state.agentOpen[agentId] = true;
  renderAgents();
  const model = draft.model ?? row?.model ?? '';
  const result = await safe(() => window.aecp.sayHiAgent(agentId, model || undefined), null);
  state.sayHiBusy[agentId] = false;
  state.sayHi[agentId] = result || { ok: false, agentName: row?.name || agentId, model: model || null, reason: 'No answer was received.', durationMs: 0 };
  renderAgents();
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
  if (!confirmText(`Install AECP v${state.update.latestVersion}? The installer is downloaded from the allowlisted private GitHub Release and SHA-256 verified before launch.`)) return;
  toast('Downloading and verifying the update…');
  const result = await safe(() => window.aecp.applyUpdate());
  if (result?.ok) toast('Update verified. AECP will close and install the new version.');
}

async function rollbackUpdate() {
  const tx = state.updateTransaction;
  if (!(tx?.state === 'ROLLBACK_REQUIRED' && tx?.rollbackInstaller && tx?.rollbackSha256)) return;
  if (!confirmText(`Reinstall the retained, SHA-256 verified AECP v${tx.currentVersion} rollback package?`)) return;
  toast('Verifying retained rollback installer…');
  const result = await safe(() => window.aecp.rollbackUpdate());
  if (result?.ok) toast('Rollback verified. AECP will close and reinstall the previous version.');
}

async function exportBackup() {
  const result = await safe(() => window.aecp.exportBackup());
  if (result?.path) toast(`Backup exported: ${result.fileCount} files, credentials excluded.`);
}

async function restoreBackup() {
  const result = await safe(() => window.aecp.restoreBackup());
  if (result?.ok) toast('Restore staged and verified. AECP will restart to apply it.');
}

async function clearEvidenceData() {
  const result = await safe(() => window.aecp.clearEvidence());
  if (!result) return;
  toast('AECP evidence cleared. Workspace files were not touched.');
  await loadAll();
}

async function removeWorkspaceBindingData() {
  const result = await safe(() => window.aecp.removeWorkspaceBinding());
  if (!result) return;
  toast(result.removed ? 'Workspace binding removed. Original project files remain untouched.' : 'No Workspace binding to remove.');
  await loadAll();
}

async function clearCredentialData() {
  const result = await safe(() => window.aecp.clearStoredCredentials());
  if (!result) return;
  toast('Stored AECP credentials cleared.');
  await loadAll();
}

async function resetLocalStateData() {
  const result = await safe(() => window.aecp.resetLocalState());
  if (!result) return;
  toast('AECP local state reset. Workspace/project files remain untouched.');
  closeProviderSettings();
  await loadAll();
}

async function chooseWorkspace() {
  const hadWorkspace = Boolean(state.data?.currentWorkspace || state.data?.workspaces?.length);
  const workspace = await safe(() => window.aecp.selectWorkspace());
  if (!workspace) return;
  state.view = 'start';
  $('#welcomeOverlay').classList.add('hidden');
  toast(`Workspace connected: ${workspace.name}`);
  await loadAll();
  if (!hadWorkspace && state.tasks.length === 0) {
    await createSampleTask();
  }
}

async function refreshWorkspace() {
  await safe(() => window.aecp.refreshWorkspace());
  await loadAll();
  toast('Local Workspace refreshed.');
}

async function addRepository() {
  const workspace = await safe(() => window.aecp.addRepository());
  if (!workspace) return;
  toast('Repository added inside the authorized Workspace.');
  await loadAll();
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
  const maxTurns = Math.max(1, Math.min(200, Number($('#loopTurns')?.value || 20)));
  const maxFailedAttempts = Math.max(1, Math.min(20, Number($('#loopFailures')?.value || 8)));
  const wallMinutesRaw = Number($('#loopWallMinutes')?.value || 0);
  const providerCostRaw = Number($('#loopProviderCost')?.value || 0);
  const localComputeMinutesRaw = Number($('#loopLocalComputeMinutes')?.value || 0);
  const maxWallClockMinutes = wallMinutesRaw > 0 ? Math.min(1440, wallMinutesRaw) : null;
  const maxProviderReportedCost = providerCostRaw > 0 ? providerCostRaw : null;
  const maxLocalComputeMinutes = localComputeMinutesRaw > 0 ? Math.min(1440, localComputeMinutesRaw) : null;
  const checkpointEvery = Math.max(1, Math.min(10, Number($('#loopCheckpoint')?.value || 2)));
  if (!goal || !done) {
    toast('Goal and Definition of Done are both required.', 'error');
    return;
  }
  const config = {
    goal, done, maxIterations, maxTurns, maxFailedAttempts, maxWallClockMinutes, maxProviderReportedCost, maxLocalComputeMinutes, checkpointEvery,
    workspaceId: state.data?.currentWorkspace?.id || null,
    providerPolicy: { supervisor: 'chatgpt-web', worker: 'explicit-command-card', reviewer: 'chatgpt-web' },
    permissionPolicy: { mode: 'WEB_SAFE_BRIDGE', localCapabilities: ['inspect-workspace','git-status'], escalation: 'explicit-user-action' },
    verificationPolicy: { resultCapsuleRequired: true, modelSelfPassForbidden: true },
    stopConditions: ['DONE_VERIFIED','MAX_ITERATIONS','MAX_FAILED_ATTEMPTS','NO_PROGRESS','WALL_CLOCK_BUDGET','PROVIDER_CALL_BUDGET','PROVIDER_COST_BUDGET','LOCAL_COMPUTE_BUDGET','PERMISSION_UNAVAILABLE','HUMAN_APPROVAL_REQUIRED','PROVIDER_UNAVAILABLE','VERIFICATION_UNRESOLVED','USER_CANCELLED']
  };
  localStorage.setItem('aecp-goal-loop', JSON.stringify(config));
  const prompt = `AECP_GOAL_LOOP_V1\n\nYou are the reasoning supervisor for an AI Engineering Control Plane Goal Loop.\n\nGOAL\n${goal}\n\nDEFINITION OF DONE\n${done}\n\nLOOP BUDGET\nMaximum iterations: ${maxIterations}\nMaximum agent/tool turns: ${maxTurns}\nMaximum failed attempts: ${maxFailedAttempts}\nWall-clock budget: ${maxWallClockMinutes == null ? 'not set' : maxWallClockMinutes + ' minute(s)'}\nProvider-reported cost budget: ${maxProviderReportedCost == null ? 'not set' : maxProviderReportedCost}\nLocal compute budget: ${maxLocalComputeMinutes == null ? 'not set' : maxLocalComputeMinutes + ' minute(s)'}\nCheckpoint every: ${checkpointEvery} iteration(s)\n\nOPERATING CONTRACT\n1. Work in this cycle: RESEARCH -> PLAN -> ACT -> VERIFY -> REFLECT.\n2. Do not declare completion from confidence alone. Completion requires evidence against the Definition of Done.\n3. Choose the smallest high-value next action; avoid repeating an action that produced no progress.\n4. At each checkpoint summarize: progress, evidence, unresolved risks, and whether direction should change.\n5. Stop with one state only: DONE, BLOCKED, NEEDS_APPROVAL, or NEXT_ITERATION.\n6. For AECP v0.3 Web Safe Bridge, when local inspection is needed output exactly one aecp.task/v1 Command Card using only supported read-only actions (inspect-workspace or git-status). Do not invent shell/file-write privileges. Wait for the AECP Result Capsule before claiming that local action succeeded.\n7. If the goal requires a capability not available in this preview, design the next governed adapter or implementation step instead of pretending it executed.\n\nStart at iteration 1. First determine the highest-value uncertainty or action needed to move toward Done.`;
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

  const plannerModel = $('#harnessPlannerModel')?.value.trim() || '';
  const builderModel = $('#harnessBuilderModel')?.value.trim() || '';
  const reviewerModel = $('#harnessReviewerModel')?.value.trim() || '';
  const roleSelections = [
    { role: 'planner', provider: plannerProvider, model: plannerModel },
    { role: 'builder', provider: builderProvider, model: builderModel },
    { role: 'reviewer', provider: reviewerProvider, model: reviewerModel }
  ];
  const localModel = (model) => /^(?:ollama|local|lmstudio|llamacpp)\//i.test(model || '');
  const selectedIds = new Set(roleSelections.map((item) => item.provider));
  const selectedCustom = (state.providers || []).filter((provider) => selectedIds.has(provider.id));
  const customNeedsNetwork = selectedCustom.some((provider) => ['api', 'local'].includes(provider.kind));
  const builtInNeedsNetwork = roleSelections.some((selection) => {
    const info = [...Object.values(HARNESS_AGENT_PROVIDER)].find((item) => item.id === selection.provider);
    if (!info?.network) return false;
    return !(selection.provider === 'opencode' && localModel(selection.model));
  });
  const needsNetwork = customNeedsNetwork || builtInNeedsNetwork;
  const needsCredential = selectedCustom.some((provider) => provider.hasCredential);
  if (needsNetwork && !confirmText('This Harness run will allow the selected cloud-backed CLI/API providers to use network access for model inference. Local worktree/tool network remains separately restricted. Allow for this run?')) return;
  if (needsCredential && !confirmText('This Harness run will use an OS-protected provider credential for the selected endpoint. Allow credential use for this run?')) return;

  const wallMinutes = Number($('#loopWallMinutes')?.value || 0);
  const providerCost = Number($('#loopProviderCost')?.value || 0);
  const localComputeMinutes = Number($('#loopLocalComputeMinutes')?.value || 0);
  const config = {
    goal, done,
    maxIterations: Math.max(1, Math.min(5, Number($('#loopIterations')?.value || 3))),
    maxTurns: Math.max(1, Math.min(200, Number($('#loopTurns')?.value || 20))),
    maxFailedAttempts: Math.max(1, Math.min(20, Number($('#loopFailures')?.value || 8))),
    maxWallClockMs: wallMinutes > 0 ? Math.min(1440, wallMinutes) * 60 * 1000 : null,
    maxProviderReportedCost: providerCost > 0 ? providerCost : null,
    maxLocalComputeMs: localComputeMinutes > 0 ? Math.min(1440, localComputeMinutes) * 60 * 1000 : null,
    checkpointEvery: Math.max(1, Math.min(10, Number($('#loopCheckpoint')?.value || 2))),
    plannerProvider, builderProvider, reviewerProvider,
    plannerModel,
    builderModel,
    reviewerModel
  };
  localStorage.setItem('aecp-goal-loop', JSON.stringify(config));

  const result = await safe(() => window.aecp.startHarness({
    goal, done, maxTasks: 4, maxIterations: config.maxIterations, maxTurns: config.maxTurns, maxFailedAttempts: config.maxFailedAttempts, maxWallClockMs: config.maxWallClockMs, maxProviderReportedCost: config.maxProviderReportedCost, maxLocalComputeMs: config.maxLocalComputeMs, checkpointEvery: config.checkpointEvery,
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

async function resumeAutonomy() {
  const result = await safe(() => window.aecp.resumeAutonomy());
  if (!result) return;
  state.autonomyStatus = result;
  renderControl();
  toast('Interrupted autonomous run resumed from its persisted checkpoint.');
}

async function cancelAutonomy() {
  const result = await safe(() => window.aecp.cancelAutonomy());
  if (result) { state.autonomyStatus = result; renderControl(); toast('Cancellation requested.'); }
}

async function openAutonomyWorktree() {
  await safe(() => window.aecp.openAutonomyWorktree());
}

async function applyAutonomy() {
  if (!confirmText('Apply the verified autonomous patch to your real Workspace? AECP will first require the Workspace to still be clean and at the same Git HEAD.')) return;
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

async function openProviderSettings() {
  providerFocusReturn = document.activeElement;
  $('#providerOverlay').classList.remove('hidden');
  $('#motionPreference').value = state.motion;
  await refreshEngineeringSettings();
  $('#providerNameInput')?.focus();
}

function closeProviderSettings() {
  $('#providerOverlay').classList.add('hidden');
  if (providerFocusReturn instanceof HTMLElement) providerFocusReturn.focus();
  providerFocusReturn = null;
}

function toggleLocale() {
  const current = window.AECPI18N?.getLocale?.() || 'en';
  window.AECPI18N?.setLocale(current === 'en' ? 'zh-TW' : 'en', document);
  render();
}

function bindEvents() {
  document.addEventListener('change', (event) => {
    const modelNode = event.target?.closest?.('[data-agent-model]');
    const effortNode = event.target?.closest?.('[data-agent-effort]');
    if (modelNode) {
      const id = modelNode.dataset.agentModel;
      const value = String(modelNode.value || '').trim();
      const draft = (state.agentDraft[id] ||= {});
      if (modelNode.tagName === 'SELECT' && value === CUSTOM_MODEL_VALUE) {
        draft.modelCustom = true;
        draft.model = '';
        renderAgents();
      } else {
        draft.model = value;
        if (modelNode.tagName === 'SELECT') delete draft.modelCustom;
        // codex-official's Say-hi button is enabled or disabled based on whether a model is chosen; 'change'
        // only fires once the person leaves the field, so re-rendering here never interrupts their typing.
        if (id === 'codex-official') renderAgents();
      }
    }
    if (effortNode) (state.agentDraft[effortNode.dataset.agentEffort] ||= {}).effort = String(effortNode.value || '');
  });
  document.addEventListener('toggle', (event) => {
    const node = event.target?.closest?.('[data-agent-settings]');
    if (node) state.agentOpen[node.dataset.agentSettings] = Boolean(node.open);
  }, true);
  $('#workspaceButton').addEventListener('click', chooseWorkspace);
  $('#chooseWorkspaceButton').addEventListener('click', chooseWorkspace);
  $('#welcomeChooseButton').addEventListener('click', chooseWorkspace);
  $('#refreshButton').addEventListener('click', refreshWorkspace);
  $('#addRepoButton').addEventListener('click', addRepository);
  $('#openWorkspaceButton').addEventListener('click', () => safe(() => window.aecp.openWorkspace()));
  $('#terminalButton').addEventListener('click', () => safe(() => window.aecp.openTerminal()));
  $('#openChatGPTButton').addEventListener('click', openChatGPT);
  $('#refreshBrowserWindowsButton').addEventListener('click', refreshBrowserWindows);
  $('#dockBrowserLeftButton').addEventListener('click', () => dockBrowser('left'));
  $('#dockBrowserRightButton').addEventListener('click', () => dockBrowser('right'));
  $('#browserWindowSelect').addEventListener('change', renderBrowserDock);
  $('#startMcpButton').addEventListener('click', startMcp);
  $('#stopMcpButton').addEventListener('click', stopMcp);
  $('#copyMcpButton').addEventListener('click', copyMcpConnection);
  $('#checkUpdateButton').addEventListener('click', checkUpdate);
  $('#applyUpdateButton').addEventListener('click', applyUpdate);
  $('#rollbackUpdateButton').addEventListener('click', rollbackUpdate);
  $('#exportBackupButton').addEventListener('click', exportBackup);
  $('#restoreBackupButton').addEventListener('click', restoreBackup);
  $('#clearEvidenceButton').addEventListener('click', clearEvidenceData);
  $('#removeWorkspaceBindingButton').addEventListener('click', removeWorkspaceBindingData);
  $('#clearCredentialsButton').addEventListener('click', clearCredentialData);
  $('#resetLocalStateButton').addEventListener('click', resetLocalStateData);
  $('#savePolicyButton').addEventListener('click', saveWorkspacePolicySettings);
  $('#motionPreference').addEventListener('change', (event) => {
    state.motion = event.target.value === 'reduced' ? 'reduced' : 'system';
    localStorage.setItem('aecp-motion', state.motion);
    render();
  });
  $('#connectGitHubButton').addEventListener('click', connectGitHub);
  $('#openReleasesButton').addEventListener('click', () => safe(() => window.aecp.openReleases()));
  $('#importClipboardButton').addEventListener('click', importFromClipboard);
  $('#sampleButton').addEventListener('click', createSampleTask);
  $('#modeButton').addEventListener('click', () => { state.engineering = !state.engineering; if (!state.engineering && state.view === 'trace') state.view = 'start'; render(); });
  $('#themeButton').addEventListener('click', cycleTheme);
  $('#languageButton').addEventListener('click', toggleLocale);
  $('#settingsButton').addEventListener('click', openProviderSettings);
  $('#closeProviderButton').addEventListener('click', closeProviderSettings);
  $('#cancelProviderButton').addEventListener('click', closeProviderSettings);
  selectAll('.view-tab').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

  $('#providerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: $('#providerNameInput').value,
      kind: $('#providerKindInput').value,
      baseUrl: $('#providerUrlInput').value,
      defaultModel: $('#providerModelInput').value,
      wireApi: $('#providerWireApiInput')?.value || 'responses',
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#providerOverlay').classList.contains('hidden')) {
      event.preventDefault();
      closeProviderSettings();
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target?.classList?.contains('view-tab')) {
      const tabs = selectAll('.view-tab').filter((tab) => !tab.classList.contains('engineering-only') || state.engineering);
      const current = tabs.indexOf(event.target);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const target = tabs[(current + delta + tabs.length) % tabs.length];
      target?.focus();
      target?.click();
    }
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
      if (action === 'edit-workspace-policy') {
        await openProviderSettings();
        $('#policyMaxRisk')?.focus();
      }
      if (action === 'add-repository-edge') await addRepository();
      if (action === 'manage-provider-edges') await openProviderSettings();
      if (action === 'open-chatgpt') await openChatGPT();
      if (action === 'sample-task') await createSampleTask();
      if (action === 'show-loop') setView('loop');
      if (action === 'apply-loop-preset') {
        if (applyLoopPreset(actionNode.dataset.preset)) toast(`Goal Loop preset applied: ${LOOP_PRESETS[actionNode.dataset.preset]?.label || actionNode.dataset.preset}.`);
      }
      if (action === 'copy-loop-prompt') await copyGoalLoopPrompt();
      if (action === 'start-autonomy') await startAutonomy();
      if (action === 'resume-autonomy') await resumeAutonomy();
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
    const saveNode = event.target.closest('[data-agent-save]');
    if (saveNode) { await saveAgentSettings(saveNode.dataset.agentSave); return; }
    const sayHiNode = event.target.closest('[data-agent-sayhi]');
    if (sayHiNode) { await sayHiToAgent(sayHiNode.dataset.agentSayhi); return; }
    const agentNode = event.target.closest('[data-agent-id]');
    if (agentNode) {
      await launchAgent(agentNode.dataset.agentId);
      return;
    }
    const officialLogin = event.target.closest('[data-worker-login-official]');
    if (officialLogin) {
      const result = await safe(() => window.aecp.loginOfficialWorker(), null);
      if (result?.launched) toast('Opened isolated Codex OFFICIAL login. Complete sign-in in that terminal, then Check health.');
      return;
    }
    const healthNode = event.target.closest('[data-provider-health]');
    if (healthNode) {
      const id = healthNode.dataset.providerHealth;
      const provider = state.providers.find((item) => item.id === id);
      if (!provider) return;
      let networkApproved = false;
      let credentialApproved = false;
      if (['api', 'local', 'remote-mcp', 'codex-worker'].includes(provider.kind)) {
        networkApproved = confirmText('Check this provider endpoint now? This performs a bounded health request using the configured URL.');
        if (!networkApproved) {
          const result = await safe(() => window.aecp.checkProviderHealth(id, { networkApproved: false }), null);
          if (result) {
            Object.assign(provider, { status: result.status, healthDetail: result.detail, healthCheckedAt: result.checkedAt });
            renderProviders();
          }
          return;
        }
      }
      if (provider.hasCredential) {
        credentialApproved = confirmText('This health check needs the OS-protected provider credential. Allow credential use for this one bounded probe?');
        if (!credentialApproved) {
          const result = await safe(() => window.aecp.checkProviderHealth(id, { networkApproved, credentialApproved: false }), null);
          if (result) {
            Object.assign(provider, { status: result.status, healthDetail: result.detail, healthCheckedAt: result.checkedAt });
            renderProviders();
          }
          return;
        }
      }
      const result = await safe(() => window.aecp.checkProviderHealth(id, { networkApproved, credentialApproved }), null);
      if (result) {
        Object.assign(provider, { status: result.status, healthDetail: result.detail, healthCheckedAt: result.checkedAt });
        renderProviders();
        toast(`${provider.name}: ${result.status}`, result.status === 'READY' ? 'info' : (result.status === 'UNAVAILABLE' ? 'error' : 'info'));
      }
      return;
    }
    const deleteNode = event.target.closest('[data-delete-provider]');
    if (deleteNode) {
      const id = deleteNode.dataset.deleteProvider;
      if (confirmText('Remove this optional provider and its stored credential from AECP?')) {
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
  systemThemeMedia?.addEventListener?.('change', () => {
    if (themeController.followsSystem()) render();
  });
  await loadAll();
}

boot();
