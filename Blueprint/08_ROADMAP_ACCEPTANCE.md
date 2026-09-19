# 08 — Roadmap and Acceptance Gates

## P0 — Product foundation

Deliverables:
- complete Blueprint source of truth
- secure Electron shell
- local persistence
- first-run wizard
- Workspace folder selection
- tool detection

Acceptance:
- no privileged renderer access
- no remote ChatGPT content loaded with privileged preload
- app starts with no external API key

## P1 — Safe Bridge MVP

Deliverables:
- Open official ChatGPT
- explicit clipboard import
- Command Card validation
- task creation/state
- risk preview
- explicit run/cancel
- Result Capsule copy

Acceptance:
- clipboard is never polled in background
- invalid cards produce actionable validation errors
- no ChatGPT scraping/injection/network interception

## P2 — Local engineering execution

Deliverables:
- PowerShell execution inside bound Workspace
- timeout/cancel
- stdout/stderr capture
- Git status/branch/remote detection
- trace/evidence storage
- deterministic verifier

Acceptance:
- cwd outside Workspace rejected
- dangerous/high-impact actions blocked or approval-gated
- write task cannot finish without verification/manual gate

## P3 — Multi-repository control plane

Deliverables:
- attach/detect multiple local repos
- per-repo health/branch/dirty state
- task resource bindings
- repo write locks
- worktree-per-task implementation

Acceptance:
- conflicting writes are prevented
- dirty main checkout is never silently overwritten

## P4 — Provider/Tool extensibility

Deliverables:
- Provider Registry
- encrypted API credential references
- Local Provider adapter
- MCP adapter slot
- capability matrix

Acceptance:
- Safe Bridge remains usable with every optional provider disabled
- switching provider never changes local security policy implicitly

## P4.5 — Execution-mode resolution

Deliverables:
- Web Safe Bridge mode remains the universal fallback
- Local Autonomous Loop adapter contract
- Official Full MCP adapter contract
- automatic readiness/recommendation UI
- common Goal/Done/Evidence model across modes

Acceptance:
- unavailable modes are never shown as ready
- local worker detection is factual
- changing execution mode never changes Workspace permissions implicitly
- Full MCP mode requires end-to-end connector/tunnel health before write capability is enabled
- Local Autonomous mode must enforce iteration/time/permission limits outside the model

## P4.6 — Bounded autonomous execution

Deliverables:
- clean Git-root preflight
- isolated detached worktree per autonomous run
- OpenCode bounded write adapter
- Codex workspace-write sandbox adapter
- deterministic verifier profiles
- iteration/timeout/cancel budgets
- persisted run evidence
- verified binary patch
- explicit Apply gate with base-HEAD/clean-state revalidation

Acceptance:
- active Workspace is unchanged while Worker runs
- failed verification can iterate only within configured budget
- source changes cannot be applied if source HEAD/state drifted
- no automatic commit/push/publish
- CI proves isolation and explicit apply on a real temporary Git repository

## P4.7 — Harness Engineering Control Plane

Deliverables:
- Planner / Worker / Reviewer role model
- durable Task Queue
- Scheduler with dependency/lock/risk checks
- repository/worktree-per-task isolation
- bounded rework loop
- structured Worker/Review contracts
- event bus and materialized Dashboard state
- GitHub CI event adapter
- maintenance/garbage-collection task type

Acceptance:
- a Goal becomes a Plan and Task graph;
- Harness dispatches Worker without manual agent-to-agent copy/paste;
- Verifier independently gates completion;
- Reviewer can return PASS/REWORK/HUMAN_REQUIRED;
- queue dispatches the next eligible task;
- stale locks and interrupted runs are recoverable;
- all loops have finite budgets;
- external GitHub events are correlated before state mutation.

## P5 — Desktop/engineering adapters

Deliverables:
- browser window dock adapter
- Windows UI Automation adapter
- Python worker
- optional OCR/STT/indexing/local-model services

Acceptance:
- desktop adapter is capability-scoped
- ChatGPT DOM remains untouched

## P6 — Remote supervision

Deliverables:
- authenticated Remote Gateway or supported official integration
- device pairing/revocation
- encrypted task transport
- replay protection
- remote task/result status

Acceptance:
- no public inbound port by default
- remote cannot exceed local Workspace policy
- lost device/session can be revoked

## P6.5 — Private Store distribution

Deliverables:
- Partner Center identity mapping
- Store-compatible Windows package
- x64 + ARM64 submission path
- Private audience instructions
- Store-managed update path
- GitHub Preview channel retained independently

Acceptance:
- clean Windows device acquires AECP from the private Store listing
- Microsoft publisher trust is shown
- no SmartScreen download warning on Store acquisition
- repository can remain private
- Store release does not break GitHub Preview updates

## P7 — Stable 1.0

Required:
- trusted Windows distribution: Microsoft Store Private/Public audience **or** consistently signed x64/ARM64 installers
- Store lane preferred when the goal is zero SmartScreen download friction
- backup/migration strategy
- upgrade/uninstall tests
- accessibility pass
- localization framework
- dependency/license/security audit
- crash recovery tests
- complete user documentation

## MVP definition used for first executable

The first executable is **not** claimed to be P7. It is considered a usable preview only if P0 + P1 + the safe subset of P2 are working and independently audited against this Blueprint.


## Current gate status — 2026-09-19

P4.7 Harness Engineering Control Plane is **substantially implemented as a governed prototype**. Durable queue/scheduler, task isolation, bounded rework, event journal, evidence, policy/locks, GitHub delivery, CI monitoring and human-gated merge are now present.

P4.7 is **not yet accepted as production-complete**. Remaining acceptance work includes crash-safe substep resume, authenticated/idempotent external GitHub events, full multi-repository routing, complete security enforcement across every adapter, and comprehensive integration/E2E verification.

See `23_IMPLEMENTATION_STATUS.md` for the exact current maturity matrix and ordered completion list.


## 2026-09-19 implementation closure update

P4.7 core acceptance is now implemented in code: durable queue/scheduler, dependency/resource routing, isolated worktrees, bounded rework, verifier/reviewer gates, locks/leases, recovery, evidence, policy, GitHub delivery, CI feedback and human-gated merge are present.

The remaining P4.7 acceptance item is the **authenticated inbound GitHub event receiver**. Current CI monitoring is commit-SHA polling with durable idempotency and failed-log evidence; polling is deliberately retained as the safe fallback until a webhook/GitHub App transport is configured.

P5/P6 are intentionally separated from the core local Control Plane: Windows UI Automation and LAN/Internet remote supervision require additional capability and identity boundaries. A local authenticated read-only loopback gateway is now implemented.


## 2026-09-19 acceptance refresh

P4.7 is now implemented at the software-control-plane level: durable queue/scheduler, resource-aware multi-repo routing, isolated worktrees, bounded rework, independent verification/review, leases/recovery, event ledger, authenticated/idempotent GitHub webhook ingestion, CI evidence, policy enforcement, adapter security audit and deterministic infrastructure E2E are present.

P6 local security foundation is also implemented: loopback-only authenticated supervision plus expiring one-time device pairing, read-only device credentials and revocation. LAN/Internet transport remains intentionally disabled by default and requires an externally owned authenticated transport/identity.

P5 Windows UI Automation remains an optional capability layer and is not part of the safe core. P6.5 Store identity/submission and production code signing remain operator-owned trust operations. P7 requires clean Windows install/update/rollback, accessibility/localization, signed distribution and full release-environment evidence.
