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

A Provider Registry can attach API-backed models later. Keys are OS-protected and referenced by opaque credential IDs.

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

A future Codex-like remote supervision path may allow a phone/browser conversation to submit a task that executes on the local AECP node. This is **not** implemented by scraping ChatGPT. It requires an authenticated Remote Gateway or supported official integration with device identity, encrypted transport, replay protection, short-lived credentials, task-level authorization and revocation. No inbound public port is opened by default.

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

All autonomous loops are bounded by iteration, timeout, permission, verifier and evidence gates.

## 12. Technology direction

Initial implementation is an Electron desktop application because it enables a fast Windows-first delivery path, strong Chromium isolation controls, native dialog/clipboard/process APIs, and straightforward x64/ARM64 packaging. Electron security requirements are mandatory: context isolation on, Node integration off in renderer, sandboxing on, narrowly-scoped preload API, strict navigation/window-open rules.

Windows packages are produced for x64 and ARM64. Native modules are deliberately avoided in the bootstrap release to keep ARM64 cross-packaging deterministic.


## 13. Current implementation baseline — 2026-09-19

The current implementation has crossed from architecture definition into a durable governed Control Plane prototype. The runtime now includes mission planning, durable task state, bounded scheduling, leases/heartbeat, recovery, policy checks, locks, evidence, context capsules, provider routing, GitHub delivery, CI monitoring, bounded CI-driven rework, human-gated PR merge and a live Harness Command Center.

The authoritative detailed status and remaining backlog is `23_IMPLEMENTATION_STATUS.md`. Code, Blueprint and Dashboard must be kept aligned; roadmap items are never considered implemented merely because they are documented.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.


## Runtime governance hardening — 2026-09-19

AECP now treats adapter security as a first-class control-plane invariant. Every registered adapter has an explicit decision for READ, WRITE, EXECUTE, NETWORK and CREDENTIAL capabilities. Ordinary workspace writes are allowed only inside the configured workspace boundary; publishing, merge, delete, credential and system actions remain approval-gated.

Failure recovery is evidence-driven and bounded: transient/deterministic failures may return to the existing task loop within the configured iteration budget, while credential, permission, policy, production and unknown failures stop at HUMAN_REQUIRED. Recovery plans explicitly declare that they grant no new permissions and record the evidence required to justify the transition.

Maintenance drift scans operate on the actual mission repository roots rather than only the AECP runtime-data directory.


## Remote supervision security foundation — 2026-09-19

The local supervision gateway now has an explicit device-pairing foundation: a short-lived one-time pairing code creates a short-lived READ_ONLY device credential; credentials can be revoked and enumerated. The gateway remains bound to loopback by default. Pairing never grants task execution, write, merge, credential or system authority. LAN/Internet transport is still a separate deployment gate and must inherit the same policy model.
