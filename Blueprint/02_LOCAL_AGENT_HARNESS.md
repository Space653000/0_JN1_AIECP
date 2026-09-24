# 02 — Local Agent Harness

## 1. Purpose

The Local Agent Harness is the permanent runtime. Models/providers are replaceable. It is responsible for deterministic orchestration, permissions, execution state, verification and evidence.

## 2. Core components

- `TaskRuntime` — durable state machine
- `ContextBuilder` — selects local facts and produces compact capsules
- `PolicyEngine` — calculates capability/risk and denies forbidden actions
- `ToolRouter` — resolves capability to adapter
- `ExecutionEngine` — runs bounded capability steps with timeout/cancel semantics
- `WorkspaceLockManager` — prevents conflicting write tasks through durable resource locks/leases
- `Verifier` — deterministic completion checks
- `EvidenceStore` — trace + artifacts + hashes
- `RecoveryManager` — retry, cancel, rollback hints and crash recovery
- `ProviderRouter` — optional supervisor/worker/reviewer provider selection

## 3. Task state machine

```text
INBOX
  ↓ validate
READY
  ↓ dispatch
DISPATCHED
  ↓ prepare
RUNNING ───────────→ WAITING_USER
  │                    │
  │ error              └──── approve/deny ────┐
  ▼                                           │
FAILED ← retry ────────────────────────────────┘
  ↑
  │ verification failed
VERIFYING
  │ pass
  ▼
PASS → READY_TO_COMMIT → DONE
```

Other terminal/interruption states: `CANCELLED`, `ROLLED_BACK`, `BLOCKED`.

The legacy v0.1 Safe Bridge used the simplified read-only path. The current runtime uses durable Mission/Task state, dependencies, leases, bounded execution/rework, verification, approval and terminal states while preserving the canonical Task model.

## 4. Pipeline model

Borrow the mature software-delivery concepts of stage, step, conditional execution, timeout and failure strategy.

Default logical stages:

1. `UNDERSTAND` — schema/resource validation
2. `PREPARE` — context and Workspace binding
3. `EXECUTE` — one or more bounded capability steps
4. `VERIFY` — deterministic assertions
5. `PACKAGE_RESULT` — evidence + Result Capsule

The current governed mutating path adds locks, isolated worktrees, policy/approval, deterministic verification, evidence and rollback/recovery stages without replacing the task model.

Each bounded step can carry:
- `id`
- `type`
- `inputs`
- `timeoutMs`
- `risk`
- `condition`
- `onFailure`: abort | retry | wait-user | rollback-hint
- `maxRetries`
- expected evidence

## 5. Capability execution rules

### v0.1.0

Only two Command Card capabilities are executable from imported conversation text:

- `inspect-workspace`
- `git-status`

Both are read-only and GREEN. AECP itself invokes fixed local operations; the conversation does not provide a shell string.

### Governed write/command adapters

File mutation/project command execution is exposed only through adapters that enforce:
- explicit Workspace-scoped capability declaration;
- path canonicalization;
- risk preview/approval;
- timeout/cancel;
- bounded stdout/stderr;
- secret redaction;
- deterministic verifier or manual verification gate;
- evidence and rollback/recovery metadata;
- repository locks/worktrees when relevant.

Raw AI text must never grant its own permission.

## 6. Workspace locks and concurrency

Read-only tasks do not require write locks. Write tasks use durable repository/workspace locks; one conflicting writer per resource is allowed at a time. Coding tasks use isolated Git worktrees to keep the user's main checkout undisturbed.

Lock record:
- task ID
- resource ID
- capability (read/write)
- owner runtime
- acquired timestamp
- lease/heartbeat

A stale write lock never disappears silently; recovery records why it was released.

## 7. Verification

Verification is independent of the provider.

The Safe Bridge still supports `operation-success` verification for fixed read-only adapters. Governed engineering tasks use deterministic verification profiles such as:
- process exit code == expected
- expected file exists
- JSON/YAML parses
- Git working tree has expected changes
- unit tests pass
- build artifact exists and hash is recorded
- user-specified output matches

A write task cannot reach accepted completion without deterministic verifier evidence or an explicit human/manual verification gate.

## 8. Evidence

Every execution records:
- task/card input hash
- Workspace identity
- capability adapter used
- step start/end events
- verification result
- evidence payload
- Result Capsule hash

Trace is append-only at the task level. Sensitive values are redacted before persistence.

## 9. Context strategy

Do not upload entire repositories by default. Local ContextBuilder direction:

`source → index/search → select → reduce → capsule`.

Context Capsule contains only the minimum needed for reasoning:
- current objective
- architecture constraints
- relevant file paths/snippets selected by user/local retrieval
- Git branch/status
- last task outcomes
- unresolved decisions
- available capabilities

## 10. Crash/restart behavior

On startup, the mutating runtime must:
1. load non-terminal tasks;
2. identify orphaned executions;
3. verify Workspace locks;
4. show recovery state;
5. never blindly replay a mutating operation.

Read-only Safe Bridge operations remain short-lived; the current control plane also persists mutating Task/Harness state at each transition for restart recovery.

## 11. Current executable scope

Implemented:
- explicit Command Card import
- Workspace binding
- read-only capability allowlist
- local tool detection
- Git repository/status inspection
- Task Board/Pipeline/Graph/Trace/Evidence
- trace/evidence recording
- Result Capsule generation
- official ChatGPT browser launcher and explicit copy-back
- Provider Registry metadata and encrypted secret storage

Current boundaries:
- arbitrary shell execution from conversation text — **not exposed**;
- bounded workspace mutation — implemented only inside policy-scoped worktrees/workspace-write adapters;
- governed Git commit/push/Draft PR — implemented; merge remains human-gated;
- Windows desktop integration — scoped docking plus read-only general-app UI Automation; browser/ChatGPT inspection remains deny-by-default;
- remote supervision — authenticated READ_ONLY + APPROVAL_ONLY pairing/revocation; remote task submission remains intentionally disabled;
- official MCP/local MCP — local authenticated MCP foundation implemented; any public/official tunnel remains deployment/product support dependent;
- external/OpenAI-compatible provider invocation — implemented behind NETWORK/CREDENTIAL approval.

These boundaries are enforced capabilities, not hidden permissions.


## 12. Harness Engineering expansion

The Harness is the permanent control plane around agent execution. It owns Queue, Scheduler, Locks, State Machine, Budgets, Policy, Verification, Recovery and Evidence.

### Planner / Worker / Reviewer loop

```text
Claude Planner → Task Queue → Codex Worker → Verifier → Claude Reviewer
                                      ↑                 │
                                      └── REWORK ───────┘
```

The Worker cannot declare its own success. The Harness verifier determines pass/fail, and the Reviewer determines Blueprint/Plan compliance.

### Queue requirements

Tasks are durable objects with dependencies, priority, role, Workspace/repository bindings, limits, verifier profile and risk policy. Scheduler decisions must remain explainable after restart.

### Worktree requirements

Autonomous write tasks prefer one isolated Git worktree per task. Active user Workspaces remain unchanged until an explicit integration gate.

### Event requirements

Runtime state changes emit versioned append-only events. Dashboard state is a materialized projection, not a second source of truth.

### Maintenance / garbage collection

The Harness should schedule bounded maintenance tasks for architecture drift, dependency hygiene, test gaps, documentation drift and security rules.