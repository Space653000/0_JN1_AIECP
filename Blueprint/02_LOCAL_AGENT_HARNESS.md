# 02 — Local Agent Harness

## 1. Purpose

The Local Agent Harness is the permanent runtime. Models/providers are replaceable. It is responsible for deterministic orchestration, permissions, execution state, verification and evidence.

## 2. Core components

- `TaskRuntime` — durable state machine
- `ContextBuilder` — selects local facts and produces compact capsules
- `PolicyEngine` — calculates capability/risk and denies forbidden actions
- `ToolRouter` — resolves capability to adapter
- `ExecutionEngine` — runs bounded capability steps with timeout/cancel semantics
- `WorkspaceLockManager` — prevents conflicting future write tasks
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

The v0.1.0 preview implements the simplified safe path `READY → RUNNING → DONE/FAILED` for read-only capabilities while preserving the same canonical Task model.

## 4. Pipeline model

Borrow the mature software-delivery concepts of stage, step, conditional execution, timeout and failure strategy.

Default logical stages:

1. `UNDERSTAND` — schema/resource validation
2. `PREPARE` — context and Workspace binding
3. `EXECUTE` — one or more bounded capability steps
4. `VERIFY` — deterministic assertions
5. `PACKAGE_RESULT` — evidence + Result Capsule

Future mutating adapters add locks/worktrees/approval/rollback stages without replacing the task model.

Each future step can carry:
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

### Future write/command adapters

Before exposing file mutation or project command execution, the implementation must add:
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

v0.1.0 read-only tasks do not require write locks.

Future default: one write task per repository/workspace resource. Multiple read-only tasks may coexist. Coding tasks should prefer one Git worktree per task to isolate branches and reduce cross-agent collisions.

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

v0.1.0 uses `operation-success` verification for the two fixed read-only adapters.

Future examples:
- process exit code == expected
- expected file exists
- JSON/YAML parses
- Git working tree has expected changes
- unit tests pass
- build artifact exists and hash is recorded
- user-specified output matches

A future write task cannot reach `DONE` without at least one configured verifier or an explicit `MANUAL_VERIFICATION_REQUIRED` terminal gate.

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

On startup, future mutating runtime must:
1. load non-terminal tasks;
2. identify orphaned executions;
3. verify Workspace locks;
4. show recovery state;
5. never blindly replay a mutating operation.

Read-only v0.1.0 operations are short-lived and persist Task/Evidence state after completion.

## 11. v0.1.0 executable scope

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

Deliberately not exposed yet:
- arbitrary shell execution from conversation text
- autonomous file mutation/deletion
- Git commit/push
- desktop GUI automation
- remote mobile gateway
- official MCP write path
- external API invocation

Those are governed roadmap adapters, not hidden v0.1.0 behavior.
