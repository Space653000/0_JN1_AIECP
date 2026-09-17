# 02 — Local Agent Harness

## 1. Purpose

The Local Agent Harness is the permanent runtime. Models/providers are replaceable. It is responsible for deterministic orchestration, permissions, execution state, verification and evidence.

## 2. Core components

- `TaskRuntime` — durable state machine
- `ContextBuilder` — selects local facts and produces compact capsules
- `PolicyEngine` — calculates capability/risk and denies forbidden actions
- `ToolRouter` — resolves capability to adapter
- `ExecutionEngine` — runs bounded commands/steps with timeout/cancel
- `WorkspaceLockManager` — prevents conflicting tasks
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
  ↓ lock + prepare
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

## 4. Pipeline model

Borrow the mature software-delivery concepts of stage, step, conditional execution, timeout and failure strategy.

Default stages:

1. `UNDERSTAND` — schema/resource validation
2. `PREPARE` — context, lock, Git cleanliness, optional worktree
3. `EXECUTE` — one or more bounded steps
4. `VERIFY` — deterministic assertions/tests
5. `PACKAGE_RESULT` — evidence + Result Capsule

Each step has:
- `id`
- `type`
- `inputs`
- `timeoutMs`
- `risk`
- `condition`
- `onFailure`: abort | retry | wait-user | rollback-hint
- `maxRetries`
- expected evidence

## 5. Execution rules

- Commands always run with an explicit working directory.
- Working directory must resolve inside the bound Workspace unless policy explicitly permits otherwise.
- Shell uses argument-safe process spawning where feasible; arbitrary shell text is treated as high risk.
- Every process has timeout and cancel handling.
- stdout/stderr and exit code are captured with output-size limits and truncation metadata.
- Environment variables are allowlisted; secrets are injected only at execution time and never copied into traces.
- Network access is a declared capability.
- Admin/elevation is not available in the bootstrap release.

## 6. Workspace locks and concurrency

Default: one write task per repository/workspace resource. Multiple read-only tasks may coexist.

Future coding tasks should prefer one Git worktree per task to isolate branches and reduce cross-agent collisions.

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

Examples:
- shell exit code == 0
- expected file exists
- JSON/YAML parses
- Git working tree has expected changes
- unit tests pass
- build artifact exists and hash is recorded
- user-specified string/output matches

A write task cannot reach `DONE` without at least one configured verifier or an explicit `MANUAL_VERIFICATION_REQUIRED` terminal gate.

## 8. Evidence

Every execution records:
- task/card input hash
- policy decision
- workspace/repo identities
- step start/end
- exact adapter used
- command metadata (redacted)
- exit status
- bounded stdout/stderr summary
- verifier result
- file-change summary
- Result Capsule hash

Trace is append-only at the task level. Sensitive values are redacted before persistence.

## 9. Context strategy

Do not upload entire repositories by default. Local ContextBuilder performs:

`source → index/search → select → reduce → capsule`.

Context Capsule contains only:
- current objective
- architecture constraints
- relevant file paths/snippets selected by user/local retrieval
- Git branch/status
- last task outcomes
- unresolved decisions
- available capabilities

## 10. Crash/restart behavior

On startup:
1. load tasks in non-terminal states;
2. mark orphaned running processes as `BLOCKED_RECOVERY`;
3. verify workspace locks;
4. show a recovery card;
5. never blindly re-run a mutating step.

## 11. Bootstrap implementation scope

The first executable implements:
- task import
- workspace binding
- risk classification
- read-only tool detection
- bounded PowerShell execution after explicit user initiation/approval
- Git status/branch/remote inspection
- trace/evidence recording
- Result Capsule creation
- cancel/timeout

Desktop GUI automation, remote mobile gateway, official MCP, and autonomous multi-step planning remain adapter extensions and must not delay a safe usable baseline.
