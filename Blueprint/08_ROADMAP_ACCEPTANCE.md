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
- Local Autonomous mode must enforce iteration/turn/output/patch/file-count/time/permission limits outside the model

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
- encrypted supervision/status/approval transport
- replay protection
- remote task/result status as a read-only projection; remote task submission remains intentionally disabled

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


## Current gate status — 2026-09-22

P4.7 core software acceptance is implemented: durable queue/scheduler, dependency/resource routing, isolated worktrees, bounded Planner → Builder → deterministic Verify → Reviewer, leases/recovery, event ledger, signed/idempotent GitHub webhook ingestion, governed GitHub delivery, CI-driven rework, adapter security audit and deterministic canonical E2E.

P5 desktop capability is implemented only within its intended boundary: general Windows UI Automation is read-only, browser/ChatGPT automation-tree inspection is deny-by-default, and state-changing window docking requires SYSTEM approval. Arbitrary GUI control is not exposed.

P6 supervision boundary is implemented: loopback-first Remote Gateway, short-lived one-time pairing, READ_ONLY and APPROVAL_ONLY device scopes, revocation, request-id replay protection, encrypted TLS transport for explicitly enabled non-loopback binding, and read-only task/result projection. APPROVAL_ONLY can decide only existing approvals; remote task submission remains intentionally disabled by design.

Distribution software-side acceptance includes x64/ARM64 packaging, universal architecture selection, Windows-runner install/uninstall plus baseline→upgrade→rollback smoke gates, Store AppX x64/ARM64 manifest validation, SHA-256/provenance, updater transaction/first-boot/rollback, backup/restore, localization/accessibility, dependency/license/security and owner-gated signed-release preparation. These are accepted only from successful exact-HEAD GitHub Actions, including the non-publishing `Build and Release` PR dry-run.

The remaining items that repository code must not fabricate are **EXTERNAL OWNER GATE** operations: production Authenticode/code-signing identity, Microsoft Store publisher/certification/submission, real third-party/local provider runtime/model artifacts or credentials for provider-specific production claims, and optional public/LAN deployment identity/domain/TLS ownership.

GitHub Actions PR workflows must explicitly checkout `pull_request.head.sha`; testing only the synthetic PR merge ref is not sufficient evidence for the exact-head acceptance rule.

Canonical verification also runs `scripts/roadmap-gate-audit.cjs`, which parses every normative P0–P7 Deliverable/Acceptance/Required bullet in this file, classifies repository-verifiable vs bounded-security vs owner-required items, and emits `artifacts/roadmap-gates.json`. Any unclassified phase or missing repository evidence fails verification.

## Blueprint owner decision D10 — 2026-09-26 (append-only)

The P2 deliverable "PowerShell execution inside bound Workspace" is **deliberately not provided as a generic execution primitive**. AECP never exposes an unrestricted shell driven by AI text (permanent boundary, `.ai/BLUEPRINT.md` section 4). Commands run only as fixed, bounded, policy-checked programs (git, the deterministic verifier, registered worker commands) inside the task worktree, and `workspace:terminal` opens a terminal in the Workspace for the human. A future risk-classed, approval-gated PowerShell action would need its own work order.

## Blueprint owner decision D11 — 2026-09-26 (append-only)

The P1 "explicit run/cancel" requirement is met as follows: every run is an explicit user action (nothing runs without a click), and **cancel applies to the long-running modes** (Harness, Autonomy, Control Plane missions and tasks, STOP ALL). A read-only Safe Bridge task completes in well under a second and changes nothing, so it deliberately has no cancel control.


## Blueprint owner decision D12 — 2026-09-26 (append-only)

On Windows the official Codex desktop app installs its CLI as `codex.exe` under `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\`, while a `codex.cmd` wrapper on PATH cannot be launched without a shell (which stays forbidden). AIECP may therefore resolve `codex` to exactly that per-user install directory: the candidate must be a regular file named `codex.exe` directly inside a direct child folder of that fixed base, must not be a link or reparse point, and is used only after PATH lookup finds no native `codex.exe`. No shell, no wildcard beyond that one directory level, no other base directory. This narrows nothing else in the command-resolution rules.
