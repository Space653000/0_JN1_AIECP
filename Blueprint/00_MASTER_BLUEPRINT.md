# 00 — Master Blueprint

## 1. Product definition

**AI Engineering Control Plane (AECP)** is a Windows-first local engineering control plane. The user keeps using official ChatGPT Web as the primary conversational supervisor, while AECP provides the durable local execution environment: workspaces, files, repositories, tools, task state, policy, verification, evidence, optional local compute, and future model providers.

AECP is not another chatbot and does not clone ChatGPT. It is the operational layer between an AI conversation and real engineering work on the user's own computer.

### Primary experience

1. User talks to official ChatGPT Web.
2. User explicitly hands an actionable task to AECP.
3. AECP binds the task to one selected Workspace and its policy.
4. Local Agent Harness performs the bounded local work.
5. AECP verifies the result using deterministic checks where possible.
6. AECP stores an execution trace and evidence.
7. AECP produces a compact Result Capsule for the next ChatGPT turn.

The default path requires **no OpenAI API key**. Optional external API providers can be connected later without replacing the harness.

## 2. Product invariants

These requirements override convenience:

- **Official ChatGPT stays untouched.** No DOM injection, hidden scraping, response interception, traffic rewriting, cookie/session extraction, undocumented private endpoint usage, or reverse engineering.
- **No quota circumvention.** AECP may save cloud usage by doing bulk/local work locally, but must never bypass or evade a provider's usage limits, restrictions, or safety controls.
- **Local-first data.** Source trees, large logs, raw engineering data, indexes, embeddings, and execution artifacts remain local unless the user explicitly chooses to share them.
- **Minimum necessary cloud context.** Prefer Context Capsules over bulk project uploads.
- **Human authority.** Destructive, privileged, credentialed, publishing, billing, security-sensitive, and irreversible actions require policy checks and usually explicit approval.
- **Provider independence.** ChatGPT Web is the preferred supervisor, not a hard-coded runtime dependency.
- **Evidence over self-report.** A task is complete because state/tests/evidence prove it, not because a model says so.
- **Recoverability.** Every task has durable state, trace, outputs, timeout/cancel behavior and a clear terminal state.
- **One source of state.** Board, Pipeline, Graph and Trace are views over the same canonical task/workspace model.

## 3. System architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         AECP WORKSPACE SHELL                            │
├──────────────────────┬──────────────────────┬───────────────────────────┤
│ LOCAL COMPUTER       │ CONTROL PLANE        │ OFFICIAL CHATGPT          │
│ Workspace / Files    │ Board / Pipeline     │ Chrome/Edge/PWA/Desktop   │
│ VS Code / Terminal   │ Graph / Trace        │ official OpenAI surface   │
│ Engineering Apps     │ Policy / Providers   │ never modified by AECP    │
└───────────┬──────────┴───────────┬──────────┴────────────┬──────────────┘
            │                      │                       │
            └──────────────────────▼───────────────────────┘
                           LOCAL AGENT HARNESS
              Task Runtime | Tool Router | Verification | Audit
                                      │
       ┌──────────────────────────────┼──────────────────────────────┐
       ▼                              ▼                              ▼
   TOOL ADAPTERS                 PROVIDER ADAPTERS              DATA PLANE
 Files / Shell / Git             ChatGPT Web bridge            local config
 GitHub / Browser                Official MCP (optional)       task state
 Python / Desktop                API providers (optional)      evidence
 Local compute                   Local models (optional)       indexes
```

## 4. Architectural planes

### Presentation plane

Owns window layout, first-run onboarding, Workspace selection, task views, provider health, risk confirmations and beginner/engineering modes. It must not contain provider-specific execution logic.

### Control plane

Maps Conversations, Workspaces, Folders, Repositories, Tasks, Providers, Policies and Executors. A graph edge represents a real permission/capability relation, not decorative UI.

### Local Agent Harness

A durable runtime that accepts structured tasks, resolves context, checks policy, acquires locks, executes bounded steps, captures trace/evidence, verifies completion and emits structured results.

### Adapter plane

All external/local integrations are capability adapters. Harness logic targets interfaces rather than vendor-specific code.

- ToolAdapter: filesystem, shell, git, GitHub, browser, desktop, Python, local compute.
- ProviderAdapter: ChatGPT Web handoff, official MCP, OpenAI API, Anthropic, Gemini, local Ollama-compatible provider, future gateways.

### Data/evidence plane

Stores configuration, workspace/resource graph, task state, evidence references, traces and encrypted credential references locally. Original source files stay in their own directories; AECP stores references/hashes/metadata by default.

## 5. Default connection modes

### Mode A — Web Safe Bridge (default)

```text
Official ChatGPT Web
  │ user explicitly copies a structured task
  ▼
AECP Command Card import
  │ schema + workspace + policy + risk validation
  ▼
Local Agent Harness
  │ local execution + tests + evidence
  ▼
AECP Result Capsule
  │ explicit Copy Result
  ▼
Official ChatGPT Web
```

This mode has no OpenAI API-token billing and does not depend on undocumented ChatGPT internals.

### Mode B — Official MCP Bridge (optional)

If the user's OpenAI product/account supports the necessary official MCP capabilities, expose the same Harness protocol through an official Remote MCP/Secure MCP Tunnel path. The local task engine does not change.

### Mode C — External API Provider (optional)

The Provider Registry can attach explicitly configured API-backed models through the governed Provider Router. Keys are OS-protected and referenced by opaque credential IDs; live network/credential checks require approval and real provider claims require environment evidence.

### Mode D — Local Provider (optional)

Local LLM/vision/STT/embedding services can handle bounded high-volume work while a cloud supervisor handles high-value reasoning.

## 6. Workspace model

A Workspace is an explicit permission graph, not merely a folder.

```text
Workspace Alpha
├─ folder: D:\Alpha                      [read/write]
├─ repo: frontend                        [git]
├─ repo: backend                         [git]
├─ GitHub: owner/frontend                [read/publish-by-approval]
├─ provider: ChatGPT Web                 [supervisor]
├─ tools: shell, git, python             [execute]
└─ policy: alpha-policy-v3
```

Edges carry capabilities such as `read`, `write`, `execute`, `network`, `publish`, `credential`, and `admin`.

## 7. Canonical task lifecycle

Primary path:

`INBOX → READY → DISPATCHED → RUNNING → VERIFYING → PASS → READY_TO_COMMIT → DONE`

Alternate states:

`BLOCKED`, `WAITING_USER`, `FAILED`, `CANCELLED`, `ROLLED_BACK`.

Write tasks cannot transition directly from `RUNNING` to `DONE`; verification is mandatory.

## 8. Local compute strategy

The local computer absorbs high-volume/low-judgment workloads:

- repository indexing and semantic retrieval
- syntax/code maps
- large log reduction
- OCR, STT and vision preprocessing
- embeddings/RAG
- test/build execution
- numerical scripts and conversion
- optional local LLM bounded subtasks

ChatGPT receives only the minimum Context Capsule necessary for high-value reasoning.

## 9. Remote/mobile direction

Authenticated remote supervision is implemented at bounded scope: one-time pairing, short-lived device credentials, READ_ONLY status/event access, APPROVAL_ONLY decisions for existing approval requests, revocation and replay protection. Non-loopback binding requires explicit enablement + TLS; no public inbound port is opened by default.

**Remote task submission remains intentionally disabled** and is not emulated through ChatGPT scraping/DOM automation. Any future task-submission expansion requires a separate policy/acceptance gate and cannot inherit approval authority implicitly.

## 10. Success criteria

A novice should be able to:

1. download one Windows installer;
2. install without Node/Rust/Python developer tooling;
3. create a Workspace with a native folder picker;
4. detect and attach one or more local Git repositories;
5. open official ChatGPT without altering the browser;
6. paste/import a Command Card;
7. understand what AECP will do and approve risky actions;
8. watch task/trace/evidence status;
9. receive a verified Result Capsule;
10. copy the Result Capsule back to ChatGPT.

## 11. AI Engineering Control Plane operating model

AECP now explicitly adopts a Harness-first engineering model:

- GitHub is the engineering Source of Truth.
- Harness is the control plane and state machine.
- Claude Code is the preferred Planner/Reviewer adapter.
- Codex CLI is the preferred Local Builder adapter.
- GitHub Actions is the CI/event backbone.
- Dashboard is the human command center.
- Human remains final authority for goals and high-risk operations.

The stable abstraction is the role, not the vendor. Planner, Builder, Reviewer, Verifier and Local Compute can be remapped without changing Task state or Workspace policy.

Canonical loop: `Blueprint → Plan → Task Queue → Worker → Verify → Git/CI → Review → Rework or Accept → Next Task`.

All autonomous loops are bounded outside the model by finite iteration/provider-call/failed-attempt/no-progress/output/patch/changed-file budgets, process timeouts, optional wall-clock budget, permission gates, deterministic verifier and evidence gates.

## 11A. Formal Multi-Worker architecture — one AECP, isolated replaceable workers

This is an extension of the existing Harness-first architecture, not a second control plane and not a Dual Codex GUI design.

### Product decision

The long-term operator experience is:

```text
AECP
  ↓
Harness / Control Plane
  ├─ Codex OFFICIAL Worker
  ├─ Codex PEGA Worker
  ├─ Claude Code Planner / Reviewer
  └─ Future Provider / Worker
```

The user opens **one AECP**. AECP owns queueing, dependency resolution, worktree assignment, policy, locks, timeout, retry, cancel, verification, evidence and Git/GitHub delivery. Workers are replaceable execution processes.

### Provider is not Worker

AECP treats these as separate entities:

- **Provider** — model/API/intelligence source and its capability/health/credential contract.
- **Worker** — a concrete process/runtime identity that receives one governed task using one provider configuration.

A Provider may back multiple Workers. A Worker must have one explicit Provider identity at runtime. Task/Mission/Queue schemas remain provider-neutral.

### Codex OFFICIAL Worker

Canonical identity:

```yaml
worker_id: codex-official
worker_name: Codex OFFICIAL
provider_id: openai-official
runtime: codex-cli
```

Required isolation:

- dedicated OS process;
- dedicated `CODEX_HOME`;
- dedicated config/auth/session/runtime state;
- dedicated task/run identity;
- dedicated task-scoped worktree;
- independent health and cancellation;
- no PEGA credential/config/session material.

AECP must not implement OFFICIAL/PEGA switching by rewriting one shared `CODEX_HOME`.

### Codex PEGA Worker

Canonical identity:

```yaml
worker_id: codex-pega
worker_name: Codex PEGA
provider_id: pega
runtime: codex-cli
base_url: https://aiapi.t-cyber.com/v1
```

Required isolation is identical to OFFICIAL: separate process, `CODEX_HOME`, config/auth/session/runtime/task state and worktree.

The PEGA Provider Adapter is implemented behind the existing Provider Router abstraction. It must support the API family actually exposed by the PEGA endpoint, including current Chat Completions-compatible and Responses-compatible paths where the environment proves them. Capability negotiation must fail closed; AECP must not assume every OpenAI-compatible endpoint implements every OpenAI API feature.

PEGA-specific endpoint/model/auth logic must not be embedded in Harness, Task, Queue or Mission state machines.

### Worker runtime record

Each active/known worker projects at least:

```yaml
worker_id:
worker_name:
provider_id:
provider_name:
model:
role:
process_id:
codex_home:
task_id:
run_id:
runtime_state:
repository:
worktree:
verification_state:
started_at:
heartbeat:
timeout:
cancel_state:
evidence_refs:
```

Secrets themselves are never projected to Dashboard/evidence.

### Multi-worker scheduling

The Harness may dispatch independent READY tasks concurrently to OFFICIAL and PEGA workers.

Example:

```text
TASK-A → Codex OFFICIAL → worktree A
TASK-B → Codex PEGA     → worktree B
```

Required invariants:

1. one mutating Worker owns one task-scoped worktree at a time;
2. two Workers must never directly write the same worktree concurrently;
3. same-repository parallel tasks use different isolated Git worktrees;
4. Resource Manager + Lock Manager + Scheduler enforce ownership;
5. Worker process/task cancellation is scoped to that Worker/Task;
6. `STOP ALL` remains the only operator action that intentionally cancels all active workers;
7. one Worker/Provider becoming unavailable must not make the other Worker or Web Safe Bridge unavailable.

### Completion authority

Neither OFFICIAL nor PEGA may self-declare engineering completion.

Canonical acceptance remains:

```text
Worker
  ↓
Deterministic Verify
  ↓
Evidence
  ↓
Reviewer
  ↓
PASS / REWORK / HUMAN_REQUIRED
```

A model response is never sufficient proof. Existing bounded autonomy, max-iteration/turn/failure/no-progress/output/patch/file/time budgets, cancel controls, verified-patch policy, explicit apply gate, CI and human-gated merge remain authoritative.

### Dashboard projection

The existing Dashboard/Command Center is extended; no second GUI is created.

For every Worker it must project canonical runtime state:

- Worker name;
- Provider;
- actual configured/detected model;
- Role;
- Task;
- State;
- Runtime;
- Repository;
- Worktree;
- Verify state;
- Health;
- Heartbeat/cancel state.

Example only:

```text
Codex OFFICIAL
Provider: OpenAI
Model: <actual configured model>
Role: Builder
State: RUNNING
Task: TASK-xxx
Worktree: ...
Verify: PENDING
Health: READY

Codex PEGA
Provider: PEGA
Model: <actual configured model>
Role: Builder
State: RUNNING
Task: TASK-yyy
Worktree: ...
Verify: PASS
Health: READY
```

UI must show `UNKNOWN` when process/provider/model state cannot be verified.

### Health isolation

OFFICIAL and PEGA have independent health evaluation. Provider health retains the canonical five states:

`NOT_CONFIGURED / READY / DEGRADED / UNAVAILABLE / AUTH_REQUIRED`.

Worker readiness additionally accounts for executable discovery, isolated `CODEX_HOME`, auth/credential readiness, endpoint/model capability, process heartbeat and current task assignment.

A PEGA failure cannot downgrade OFFICIAL health, and an OFFICIAL failure cannot downgrade PEGA health.

### Security and data boundary

Adding PEGA must not lower any existing boundary:

- GitHub remains engineering Source of Truth.
- Harness/Control Plane state remains runtime truth.
- Dashboard remains a projection.
- Provider/Worker cannot bypass SecurityPolicy.
- Provider configuration cannot widen Workspace permissions.
- PEGA credentials cannot appear in OFFICIAL `CODEX_HOME`, OFFICIAL process environment, logs/evidence or Git.
- Worker never selects its own arbitrary executable, Workspace or worktree.
- High-risk publish/merge/delete/credential/system actions remain human-gated.

### Explicit non-goals

This architecture must **not** create:

- Dual Codex Desktop;
- Dual Launcher;
- PowerShell double-launch scripts;
- two Codex/ChatGPT GUI clones;
- modifications to Codex Desktop internals;
- shared-`CODEX_HOME` profile switching presented as isolation;
- direct Provider-to-Workspace execution that bypasses Harness;
- a second parallel Control Plane.

### Verification classes

This extension must distinguish:

- **STATIC** — architecture/config invariant exists and is machine-audited;
- **TESTED** — deterministic isolation/router/scheduler/dashboard tests pass;
- **CI** — exact commit workflow gates pass, including Windows/ARM64 deterministic coverage;
- **ENVIRONMENT** — real OFFICIAL/PEGA endpoint/model/auth/process execution evidence exists;
- **OWNER/EXTERNAL** — owner-supplied credentials/account/trust evidence where required.

Blueprint inclusion alone is never Runtime completion. Mock/loopback API success is never reported as real PEGA ENVIRONMENT success.

### Required acceptance matrix

Repository-verifiable acceptance must eventually prove:

1. `codex-official.CODEX_HOME != codex-pega.CODEX_HOME`;
2. auth/session/runtime stores are not shared;
3. two independent tasks may be RUNNING concurrently on OFFICIAL and PEGA;
4. same repository parallel tasks use distinct worktrees;
5. conflicting writes to one worktree/resource are rejected by locks;
6. cancelling one Worker does not cancel the other;
7. `STOP ALL` cancels all;
8. PEGA health failure does not break OFFICIAL or Web Safe Bridge;
9. OFFICIAL health failure does not break PEGA or Web Safe Bridge;
10. PEGA credential never leaks into OFFICIAL runtime/evidence/Git;
11. Task/Mission/Queue/Harness state machines do not depend on the literal string `PEGA`;
12. deterministic verifier remains sole engineering completion authority;
13. Dashboard projects Worker/Provider/model/task/state/runtime/worktree/verify/health from canonical runtime state;
14. Windows x64 and ARM64 deterministic tests remain green;
15. real PEGA `https://aiapi.t-cyber.com/v1` capability/model/auth success is accepted only from ENVIRONMENT evidence.

## 12. Technology direction

Initial implementation is an Electron desktop application because it enables a fast Windows-first delivery path, strong Chromium isolation controls, native dialog/clipboard/process APIs, and straightforward x64/ARM64 packaging. Electron security requirements are mandatory: context isolation on, Node integration off in renderer, sandboxing on, narrowly-scoped preload API, strict navigation/window-open rules.

Windows packages are produced for x64 and ARM64. Native modules are deliberately avoided in the bootstrap release to keep ARM64 cross-packaging deterministic.


## 13. Current implementation baseline — 2026-09-22

The current implementation has crossed from architecture definition into a durable governed Control Plane prototype. The runtime now includes mission planning, durable task state, bounded scheduling, leases/heartbeat, recovery, policy checks, locks, evidence, context capsules, provider routing, GitHub delivery, CI monitoring, bounded CI-driven rework, human-gated PR merge and a live Harness Command Center.

The authoritative detailed status and remaining backlog is `23_IMPLEMENTATION_STATUS.md`. Code, Blueprint and Dashboard must be kept aligned; roadmap items are never considered implemented merely because they are documented.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.


## Runtime governance hardening — 2026-09-19

AECP now treats adapter security as a first-class control-plane invariant. Every registered adapter has an explicit decision for READ, WRITE, EXECUTE, NETWORK and CREDENTIAL capabilities. Ordinary workspace writes are allowed only inside the configured workspace boundary; publishing, merge, delete, credential and system actions remain approval-gated.

Failure recovery is evidence-driven and bounded: transient/deterministic failures may return to the existing task loop within the configured iteration budget, while credential, permission, policy, production and unknown failures stop at HUMAN_REQUIRED. Recovery plans explicitly declare that they grant no new permissions and record the evidence required to justify the transition.

Maintenance drift scans operate on the actual mission repository roots rather than only the AECP runtime-data directory.


## Remote supervision security foundation — 2026-09-19

The supervision gateway has short-lived one-time pairing, revocation, READ_ONLY and APPROVAL_ONLY scopes, and replay-safe approval request IDs. APPROVAL_ONLY may only approve/reject an already-existing approval and cannot create tasks. The gateway remains loopback-first; any explicitly enabled non-loopback bind requires TLS. Public/LAN deployment identity/domain/TLS ownership remains an external deployment gate and never weakens the local policy model.


## Deterministic E2E and adapter execution gate — 2026-09-19

The engineering loop includes a clean temporary-Git infrastructure E2E matrix that validates repository discovery, policy gates, resource locks, event idempotency, evidence persistence, bounded recovery and maintenance diagnostics without external model credentials. Planner, Builder, Reviewer and deterministic verifier process launches are also subject to the Control Plane EXECUTE policy before they can start.


## Dependency and security drift gate — 2026-09-19

Maintenance includes a bounded npm security drift scan for mission repositories. It reports high/critical vulnerabilities as an engineering gate and never silently upgrades dependencies. Optional outdated-package inspection is available for explicit maintenance runs.


## Exact-HEAD CI and Windows capability boundary — 2026-09-22

PR verification for AECP CI, AECP Security and AECP Packaging explicitly checks out `pull_request.head.sha`; GitHub's synthetic PR merge ref is not accepted as a substitute for exact-head evidence. Packaging includes x64/ARM64/universal build and Windows-runner install/uninstall smoke gates.

Windows desktop integration remains capability-scoped: top-level/general-app UI Automation inspection is read-only; browser/ChatGPT automation-tree inspection is denied by default; window-state mutation such as docking requires SYSTEM approval. No ChatGPT DOM, cookie, message or browser-traffic extraction is permitted.
