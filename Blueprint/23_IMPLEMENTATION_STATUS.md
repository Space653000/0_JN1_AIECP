# 23 — Implementation Status, Decisions and Remaining Work

**Status date:** 2026-09-22  
**Branch:** `feat/control-plane-complete-loop`  
**Current integration vehicle:** PR #7  
**Purpose:** This document is the authoritative implementation snapshot for the current AECP Harness / Control Plane expansion.

## 1. Current architecture actually implemented

The implemented runtime now contains these layers:

```text
Official ChatGPT Web
        │
        │ Safe Bridge / future official MCP
        ▼
AECP Command Center
        │
        ▼
Control Plane
  Mission / Plan / Task DAG
  Queue / Scheduler / Lease
  Policy / Approval
  Lock / Recovery
  Event Journal
  Evidence / Context Capsule
        │
        ├── Planner / Reviewer → provider router
        ├── Builder → isolated worktree
        └── Verifier → deterministic gate
        │
        ▼
Git / GitHub
        │
        ├── governed branch
        ├── Draft PR
        └── GitHub Actions CI
                │
        ┌───────┴────────┐
        │                │
       PASS             FAIL
        │                │
 Human approval       bounded REWORK
        │                │
      MERGE ◄───────────┘
        │
       DONE
```

## 2. Implemented baseline

### Control Plane
- Durable mission/task state.
- Planner-driven task decomposition.
- Bounded scheduler and configurable concurrency.
- Task dependency checks.
- Task leases and heartbeat.
- Stale lease recovery after restart.
- Pause / resume / cancel.
- Human approval queue.
- Mission/task/event status exposed through Electron IPC.
- Emergency STOP ALL.

### Harness execution
- Planner → Builder → deterministic Verify → Reviewer.
- Isolated task worktrees.
- Bounded iterations.
- Reviewer outcomes including PASS / REWORK / HUMAN_REQUIRED.
- Per-run evidence roots.
- Result capsules.

### Governance
- Security action classes: READ, TEST, WRITE, INSTALL, COMMIT, PUSH, PR, MERGE, DELETE, CREDENTIAL, SYSTEM.
- GREEN / YELLOW / RED risk model.
- Workspace write policy enforced before Builder execution.
- High-risk merge requires explicit human approval.
- CI must pass before governed merge.
- Agent cannot grant itself permission.

### GitHub delivery
- GitHub CLI gateway.
- Task branch convention: `agent/<task-id>`.
- Idempotent Draft PR creation on retries.
- CI monitoring by commit SHA.
- CI failure returns task to bounded rework.
- CI success is persisted as task evidence/state.
- Governed human merge path.
- No unrestricted automatic merge/push.

### Observability
- Durable JSON state.
- JSONL event journal.
- Per-run event evidence.
- Event replay API.
- Evidence hashing / manifests.
- Command Center with missions, tasks, approvals, CI, PR and event stream.

### Extensibility
- Role-based Provider Router.
- Claude / Codex / Gemini / OpenCode / Ollama adapter foundation.
- Context Bus with bounded capsules and TTL.
- GitHub / CI / Delivery adapters separated from core state machine.

### CI
- Canonical AECP verification workflow runs the full `npm verify` gate on Windows.
- Security workflow runs independently on Ubuntu.
- Packaging workflow is separated from canonical verification to avoid duplicate/cancelled verification runs.
- Current-head CI status is always read from GitHub Actions and is **not** recorded as passed until the exact commit reports success.

## 3. Important decisions now frozen

1. **GitHub is engineering Source of Truth.**
2. **Harness runtime state is separate from GitHub source state.**
3. **Dashboard is a projection, never an independent source of truth.**
4. **Official ChatGPT Web is not scraped or DOM-controlled.**
5. **Roles are stable; vendors/providers are replaceable.**
6. **Worker success claims are never sufficient.**
7. **Deterministic verification is mandatory.**
8. **All autonomous loops are bounded.**
9. **High-risk operations require policy + explicit human approval.**
10. **Task retries reuse the task identity and delivery branch where possible.**
11. **CI failure is engineering feedback, not a terminal mystery.**
12. **Evidence and event history must survive process restart.**
13. **Parallelism is allowed only when task/resource isolation is proven.**
14. **No secret, cookie, password or ChatGPT session token is copied into the project.**

## 4. Current maturity assessment

| Layer | State |
|---|---|
| Safe Bridge | Implemented |
| Local bounded worker | Implemented |
| Planner / Worker / Reviewer | Implemented |
| Durable Task Queue | Implemented |
| Bounded scheduler | Implemented |
| Locks / leases / heartbeat | Implemented |
| Evidence / event journal | Implemented |
| Security policy / adapter audit | Implemented; high-risk actions remain approval-gated |
| Provider routing | Implemented in canonical Harness with role-specific selection |
| Governed GitHub delivery | Implemented for branch/commit/push/Draft PR/CI; merge human-gated |
| CI monitoring / bounded rework | Implemented |
| Governed PR approval / merge path | Implemented |
| Full crash-safe substep resume | Implemented |
| Full multi-repository routing | Implemented for repository-per-task execution |
| Complete GitHub event/webhook/event-bus integration | Hardened — signed inbound receiver + polling fallback; production deployment/tunnel remains external |
| Full security enforcement across every adapter | Implemented through explicit adapter security matrix + runtime SecurityPolicy; high-risk/credential/system actions remain approval-gated |
| Remote authenticated supervision | READ_ONLY + APPROVAL_ONLY pairing/revocation implemented; remote task submission disabled; non-loopback requires explicit enablement + TLS |
| Windows UI automation | Scoped read-only inspection implemented; browser/ChatGPT deny-by-default; state-changing docking requires SYSTEM approval |
| Public/remote gateway | Software boundary implemented; public deployment disabled by default and remains operator-owned |
| Private Store distribution | Software-side implemented: x64/ARM64 AppX build, manifest validation, owner-identity bundle/provenance; Partner Center submission/certification remains EXTERNAL OWNER GATE |
| One-click production-grade updater | Software-side implemented: SHA-256, durable transaction, first-boot health, retained rollback, x64/ARM64 upgrade→rollback smoke, optional pinned Authenticode signer; production signing trust remains EXTERNAL OWNER GATE |
| Full integration/E2E test suite | Repository-verifiable canonical/provider/pairing/security + Windows x64/ARM64/Store/install/upgrade/rollback/Universal smoke implemented; real-provider execution remains environment-specific |
| Maintenance / garbage collection automation | Implemented bounded scheduler/retention |

## 5. Closure status — repository work vs external gates

### P0 — Make the current loop production-correct
- Crash-safe phase persistence/resume — completed for orphaned execution and pending CI monitoring.
- CI state transitions/idempotency — completed in delivery/event paths.
- Correlation IDs/idempotency keys — implemented via event ledger and GitHub delivery IDs.
- PR rework idempotency — completed; existing delivery branch/PR is reused.
- GitHub workflow/job/log evidence — completed for CI completion and failed logs.
- Temporary Git/infrastructure hardening tests — implemented with canonical-loop E2E plus requirements/Blueprint/acceptance coverage audits; real provider-backed execution remains environment-specific.
- High-risk SecurityPolicy enforcement — implemented across the audited adapter matrix; missing adapter decisions fail deterministic verification.

### P1 — Multi-repository engineering
- Resource graph bindings for tasks — completed.
- Per-repository locks — completed.
- Multiple worktrees/repositories in one mission — completed at task routing layer.
- Cross-repo dependency scheduling — completed through task DAG/resource binding.
- GitHub repository routing — completed.
- Branch/PR/CI/evidence/event state projection into Dashboard — implemented; Dashboard remains a projection rather than Source of Truth.

### P2 — Event-driven Control Plane
- Authenticated GitHub webhook receiver — completed, opt-in.
- Event signature verification — completed.
- Correlation and replay protection — completed.
- External event deduplication — completed.
- Polling fallback retained when webhook is unavailable.
- Materialized event projection — implemented; Dashboard remains a projection and never Source of Truth.

### P3 — Maintenance / self-healing
- Expired lease cleanup — completed.
- Evidence/artifact retention policy — completed.
- Orphan worktree cleanup — completed.
- Failed-run recovery assistant — bounded evidence/log-aware classifier + safe auto-rework implemented; credential/permission/policy/production/unknown classes remain HUMAN_REQUIRED.
- Dependency/security/documentation drift scans — bounded scanners implemented and covered by canonical verification; they diagnose but never silently mutate dependencies or documentation.
- Scheduled maintenance tasks with bounded budgets — completed.

### P4 — Distribution
- x64/ARM64 architecture-specific builds — implemented in Packaging workflow; exact-HEAD Actions determine PASS.
- Universal architecture-selecting bootstrap — implemented with Windows-runner x64/ARM64 selection/install/uninstall smoke.
- Silent install/uninstall smoke on x64/ARM64 — repository-verifiable on GitHub Windows runners.
- Store AppX x64/ARM64 build + manifest/identity/architecture/capability validation — implemented in PR Packaging.
- Owner-identity Store submission bundle + SHA-256 + provenance preparation — implemented; Partner Center submission/certification/private-audience acquisition is **EXTERNAL OWNER GATE**.
- SHA-256 release verification, durable updater transaction, first-boot reconciliation, retained rollback and backup/restore — implemented.
- Real NSIS baseline → upgrade → rollback smoke — implemented on x64 and ARM64 Windows runners.
- Stable signed builds support pinned Authenticode signer verification for target + rollback installers.
- Owner-gated signed-release workflow prepares/verifies signed x64/ARM64/Universal artifacts and signed provenance when owner certificate secrets are supplied.
- Production certificate ownership/secrets and owner-authorized signed publication remain **EXTERNAL OWNER GATE**.

### P5 — Remote/mobile
- One-time authenticated device pairing and revocation — implemented.
- READ_ONLY status/tasks/approvals/events supervision — implemented.
- APPROVAL_ONLY decision of existing approvals — implemented with request-id replay safety.
- Remote task submission — intentionally disabled.
- Non-loopback binding — requires explicit `allowRemote=true` plus TLS; public deployment/domain/device identity is **EXTERNAL OWNER GATE**.
- No public inbound port by default.

## 6. Non-goals / permanent boundaries

AECP will not use:
- ChatGPT DOM scraping;
- undocumented ChatGPT APIs;
- cookie/session-token extraction;
- unrestricted AI shell execution;
- hidden background clipboard polling;
- automatic high-risk merge without explicit approval;
- infinite autonomous loops;
- public exposure of the local machine by default.

## 7. Completion definition

AECP should not be called production-complete until:

- all P0 items are green;
- multi-repo state is deterministic;
- external GitHub events are authenticated/idempotent;
- crash recovery is demonstrated;
- every high-risk action is policy-enforced;
- clean-machine install/update tests pass;
- integration/E2E tests cover the canonical loop;
- evidence can reconstruct every accepted task;
- mobile/remote controls inherit exactly the same local policy;
- release artifacts are trusted and rollbackable.

**Bottom line:** the project has moved from a Blueprint-only concept to a governed Control Plane whose repository-verifiable normative requirements are covered by deterministic tests/audits/workflows. Remaining incompleteness is external trust/account/provider/deployment evidence or capabilities intentionally denied by the current security boundary—not an untracked repository implementation backlog.


## Latest hardening completed

- Crash recovery now re-queues orphaned execution phases and resumes pending GitHub CI monitoring after restart.
- CI failures now capture failed GitHub logs into immutable evidence.
- CI-passing delivery transitions to HUMAN_REQUIRED and creates the explicit merge approval record.
- Rework resumes from the existing delivery branch instead of silently restarting from main.
- Delivery commit/push/PR paths are explicitly policy-gated by the mission's governed delivery opt-in.
- Repository discovery and task-to-repository routing are now part of mission planning; each task executes against its selected Git repository and locks its resources.
- External event idempotency ledger, signed GitHub webhook receiver, maintenance/retention service and local authenticated read-only gateway are implemented.
- Release pipeline runs a non-publishing PR dry-run and publishes only on explicit version tags; production Authenticode publication remains a separate owner-authorized manual workflow.

## Latest repository closure hardening — 2026-09-23

- Provider health now exposes bounded `NOT_CONFIGURED / READY / DEGRADED / UNAVAILABLE / AUTH_REQUIRED` states; live network/credential health probes require explicit approval.
- Provider usage observability persists only bounded numeric metadata (request outcome, model/role, latency, token/cost fields when supplied); prompts, responses, credentials and error bodies are excluded.
- A dedicated self-hosted Windows provider-evidence workflow now exists for real Ollama, OpenCode+Ollama, fixed company/local worker and canonical local Harness execution. It is an **ENVIRONMENT gate** until an actual `aecp-provider` runner produces exact-source PASS evidence.
- Mission-level Harness budgets are durable and operator-visible: provider calls, failed/no-progress attempts, optional wall-clock, output, patch bytes, changed files, task count, iterations and process timeouts.
- Local-data governance is implemented in Settings with native confirmation: clear evidence, remove Workspace binding, clear credentials and reset AECP active state. These operations are blocked while mutating work is active and do not delete Workspace/project files.
- Harness, bounded Autonomy and Control Plane mutating execution are mutually exclusive on the desktop runtime.
- Dashboard acceptance is now deterministic: the novice eight-question view, authoritative human controls, event projection and accessibility requirements are regression-tested.

## Remaining external dependency

The remaining capabilities that cannot be made genuinely production-complete by repository code alone are external trust/account/environment operations: Microsoft Store publisher identity/certification/submission/private-audience acquisition, production code-signing certificate ownership/secrets and authorized signing run, optional LAN/Internet remote-gateway deployment with a user-owned domain/device identity, and real provider execution requiring actual local/company/provider runtimes or credentials. AECP contains the software-side packaging, Store bundle, signer verification, signed-release preparation, checksum/provenance, release, policy and gateway foundations for those operations. Real provider execution now has a dedicated self-hosted Windows evidence workflow; until that workflow runs on the actual machine/model/worker and emits a matching exact-source PASS artifact, the provider environment remains an external evidence gate.


## Autonomous hardening record — 2026-09-19

### Engineering gates closed in this tranche
1. **Failure Recovery Assistant** — bounded classifier + low-risk auto-rework implemented; richer evidence-driven diagnosis remains bounded by existing authority.
2. **Adapter Security Audit Matrix** — explicit SecurityPolicy decisions are now required for READ/WRITE/EXECUTE/NETWORK/CREDENTIAL actions.
3. **Clean E2E Matrix** — temporary-Git infrastructure coverage plus x64/ARM64/Universal Windows-runner install/uninstall, Store package validation and upgrade→rollback smoke workflows are implemented. Real Ollama/OpenCode/company-worker execution is wired to the dedicated self-hosted provider evidence workflow and remains environment-gated until that machine reports PASS.
4. **Release Gate** — repository CI proves unsigned x64/ARM64/Universal build/install/uninstall, Store AppX build/manifest validation, SHA-256/provenance, and x64/ARM64 installer upgrade→rollback behavior; signer pinning/signed-release software is implemented, while actual production signing/Store trust remains an owner gate.
5. **Remote Pairing Gate** — authenticated one-time pairing, read-only credentials and revocation are implemented; LAN/Internet transport remains gated.
6. **Drift Scans** — scheduled dependency, security, Blueprint/code and documentation consistency scanners are implemented.
7. **Normative coverage** — R1–R8 requirements coverage, Blueprint 00–24 evidence coverage and P0–P7 phase-by-phase roadmap-gate coverage are canonical `npm verify` gates.

### Definition of done
Repository-verifiable engineering completion requires all six software gates, normative requirement/Blueprint coverage and exact-HEAD CI/Security/Packaging/release-dry-run evidence. A separate **Production Trust Ready** claim additionally requires owner-controlled signing/Store/provider/deployment evidence; those external operations are never fabricated by repository tests.


### Latest implementation update
The bounded Failure Recovery Assistant is now in the runtime path: transient/deterministic failures receive a constrained rework recommendation; credential, permission, policy, production and unknown failures remain HUMAN_REQUIRED. It never executes arbitrary remediation.


### Autonomous maintenance hardening — 2026-09-19

The maintenance loop now includes a bounded, non-mutating Blueprint/documentation drift scanner. It checks the authoritative Blueprint/README/status files and emits findings into maintenance results; it does not silently rewrite project documentation. This is a diagnostic gate, not a claim of production readiness.


### Security / recovery hardening — 2026-09-19

- Added an explicit adapter security matrix covering filesystem, shell, git, GitHub, browser, desktop, Python, local compute, all provider adapters, remote gateway and webhook ingestion.
- Every adapter now has an explicit READ/WRITE/EXECUTE/NETWORK/CREDENTIAL decision; missing decisions fail the audit.
- Workspace WRITE remains policy-governed but no longer forces a human gate for ordinary bounded local engineering. High-risk publish/merge/delete/credential/system actions remain approval-gated.
- Failure Recovery Assistant now consumes error/phase/CI/evidence/log signals, emits a bounded recovery plan, records NO_NEW_PERMISSIONS, and requires evidence for the recovery decision.
- CI failure recovery now uses the same classifier rather than treating every CI failure as automatically safe to rework.
- Maintenance scans actual mission repository roots for Blueprint/documentation drift and reports adapter-security audit findings.


### Remote supervision hardening — 2026-09-19

- Added expiring one-time device pairing codes with short-lived read-only device tokens.
- Added device revocation and device inventory endpoints behind bootstrap authorization.
- Remote Gateway remains loopback-only by default; pairing does not open a public port and does not grant task execution or write capability.

### Deterministic E2E hardening — 2026-09-19

- Added a clean temporary-Git canonical-loop infrastructure test covering repository discovery, policy gates, locks, event idempotency, evidence, bounded recovery and maintenance drift/security results without requiring external model credentials.
- This is an infrastructure E2E layer; Windows packaging/install smoke is repository-verifiable in Actions, while provider-backed execution and owner trust credentials remain separate environment/owner gates.
- Harness provider execution now passes through the Control Plane EXECUTE policy before Planner, Builder, Reviewer and deterministic verifier processes start.

### Dependency/security drift hardening — 2026-09-19

- Added a bounded dependency/security drift scanner using npm audit results and optional outdated-package inspection.
- Maintenance runs security drift scans on mission repositories on a long interval rather than every scheduler tick; failures are recorded as diagnostics instead of silently changing dependencies.
- High/critical npm vulnerabilities are represented as an ERROR finding; no automatic dependency upgrade is performed.

### Crash-safe substep resume — 2026-09-19

- Harness run state is persisted in harness.json at each transition/event.
- Restart recovery now reuses the same task run root and resumes persisted task state instead of always rebuilding from a fresh Harness run.
- Completed tasks are skipped, human-gated tasks remain gated, and unfinished tasks continue within the original bounded iteration budget.

### Release installer hardening — 2026-09-19

- Added a self-contained Windows bootstrap installer source that detects x64 vs ARM64 at runtime and launches the matching embedded NSIS payload.
- Release workflow now verifies source, builds x64/ARM64/Auto/Universal artifacts, performs Store dry-run packaging, executes x64/ARM64 upgrade→rollback smoke, emits SHA-256/provenance, and publishes only for explicit version tags.
- Packaging performs architecture-specific + Universal Windows-runner install/uninstall smoke, Store AppX manifest validation, and real installer upgrade/rollback smoke. PASS is accepted only from the exact PR HEAD Actions run.
- Stable update software now supports pinned Authenticode signer verification; the owner-gated signed-release workflow verifies signed x64/ARM64/Universal artifacts and emits signed provenance without storing certificate material in the repository.


## Exact-HEAD verification hardening — 2026-09-22

- AECP CI, AECP Security and AECP Packaging explicitly checkout `pull_request.head.sha` for PR verification instead of implicitly testing GitHub's synthetic merge commit.
- Acceptance Audit fails if the exact-head checkout contract is removed.
- Workflow artifacts/evidence are tied to the exact PR HEAD where applicable.
- Documentation never records a static PASS as a substitute for the live GitHub Actions result.
