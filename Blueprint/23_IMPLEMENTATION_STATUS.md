# 23 — Implementation Status, Decisions and Remaining Work

**Status date:** 2026-09-19  
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
- Repository CI workflow.
- Security workflow.
- Syntax and unit/infrastructure tests.
- Current Security workflow has passed on the latest observed commit.
- Main CI is still running at the time of this snapshot; it is **not** recorded as passed until GitHub reports success.

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
| Security policy foundation | Implemented and partially enforced |
| Provider routing foundation | Implemented |
| GitHub delivery foundation | Implemented |
| CI monitoring / bounded rework | Implemented |
| Governed PR approval / merge path | Implemented |
| Full crash-safe substep resume | Implemented |
| Full multi-repository routing | Implemented for repository-per-task execution |
| Complete GitHub event/webhook/event-bus integration | Hardened — signed inbound receiver + polling fallback; production deployment/tunnel remains external |
| Full security enforcement across every adapter | Hardened in Control Plane delivery paths; adapter-specific completion remains |
| Mobile authenticated supervision | Local authenticated read-only gateway implemented; LAN pairing not enabled by default |
| Windows UI automation | Not implemented |
| Public/remote MCP gateway | Not implemented |
| Private Store distribution | Not implemented |
| One-click production-grade updater | Partial |
| Full integration/E2E test suite | Partial |
| Maintenance / garbage collection automation | Implemented bounded scheduler/retention |

## 5. Remaining work — ordered by engineering dependency

### P0 — Make the current loop production-correct
- Crash-safe phase persistence/resume — completed for orphaned execution and pending CI monitoring.
- CI state transitions/idempotency — completed in delivery/event paths.
- Correlation IDs/idempotency keys — implemented via event ledger and GitHub delivery IDs.
- PR rework idempotency — completed; existing delivery branch/PR is reused.
- GitHub workflow/job/log evidence — completed for CI completion and failed logs.
- Temporary Git/infrastructure hardening tests — implemented; full end-to-end matrix remains.
- High-risk SecurityPolicy enforcement — hardened across governed delivery path; remaining adapter-specific audit is P0 hardening.

### P1 — Multi-repository engineering
- Resource graph bindings for tasks — completed.
- Per-repository locks — completed.
- Multiple worktrees/repositories in one mission — completed at task routing layer.
- Cross-repo dependency scheduling — completed through task DAG/resource binding.
- GitHub repository routing — completed.
- Branch/PR state projection into Dashboard — implemented; richer artifact projection remains.

### P2 — Event-driven Control Plane
- Authenticated GitHub webhook receiver — completed, opt-in.
- Event signature verification — completed.
- Correlation and replay protection — completed.
- External event deduplication — completed.
- Polling fallback retained when webhook is unavailable.
- Materialized event projection — remaining dashboard hardening.

### P3 — Maintenance / self-healing
- Expired lease cleanup — completed.
- Evidence/artifact retention policy — completed.
- Orphan worktree cleanup — completed.
- Failed-run recovery assistant — bounded classifier + safe auto-rework implemented; deeper diagnostic assistant remains.
- Dependency/security/documentation drift scans — remaining.
- Scheduled maintenance tasks with bounded budgets — completed.

### P4 — Distribution
- Reliable x64/ARM64 production builds.
- Installer smoke tests on clean Windows environments.
- Signed release channel.
- Robust update rollback.
- Private Microsoft Store lane.
- Release provenance and artifact verification.

### P5 — Remote/mobile
- Authenticated device pairing.
- Read-only mobile dashboard first.
- Approval-only remote actions next.
- Full remote task submission only after policy and revocation are proven.
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

**Bottom line:** the project has moved from a Blueprint-only concept to a real governed Control Plane prototype. The remaining work is now primarily hardening, integration completeness, distribution, and remote supervision—not redefining the core architecture.


## Latest hardening completed

- Crash recovery now re-queues orphaned execution phases and resumes pending GitHub CI monitoring after restart.
- CI failures now capture failed GitHub logs into immutable evidence.
- CI-passing delivery transitions to HUMAN_REQUIRED and creates the explicit merge approval record.
- Rework resumes from the existing delivery branch instead of silently restarting from main.
- Delivery commit/push/PR paths are explicitly policy-gated by the mission's governed delivery opt-in.
- Repository discovery and task-to-repository routing are now part of mission planning; each task executes against its selected Git repository and locks its resources.
- External event idempotency ledger, signed GitHub webhook receiver, maintenance/retention service and local authenticated read-only gateway are implemented.
- Release pipeline is explicit-tag/manual rather than silently publishing on every main push.

## Remaining external dependency

The only major capabilities that cannot be made genuinely production-complete by repository code alone are external trust/account operations: Microsoft Store publisher identity/certification/submission, production code-signing certificate ownership, and optional LAN/Internet remote gateway deployment with a user-owned domain/device identity. AECP now contains the software-side packaging, checksum, release, policy and local-gateway foundations for those operations.


## Next autonomous hardening tranche — 2026-09-19

### Engineering work to execute next
1. **Failure Recovery Assistant** — bounded classifier + low-risk auto-rework is implemented; next step is richer evidence-driven diagnosis without expanding autonomous authority.
2. **Adapter Security Audit Matrix** — enumerate every external/local adapter and require an explicit SecurityPolicy decision for READ/WRITE/EXECUTE/NETWORK/CREDENTIAL actions.
3. **Clean E2E Matrix** — exercise Mission → Plan → Queue → Build → Verify → Git → PR → CI → Review → Rework → Human Gate on temporary repositories.
4. **Release Gate** — clean Windows x64/ARM64 install, update, rollback, provenance and checksum verification.
5. **Remote Pairing Gate** — authenticated device pairing and read-only remote supervision before any remote execution capability.
6. **Drift Scans** — scheduled dependency, security, Blueprint/code and documentation consistency checks.

### Definition of done
The product is not called Production Ready until all six gates have evidence artifacts and GitHub CI reports success on the exact release commit.


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
- This is an infrastructure E2E layer; provider-backed clean Windows and real GitHub delivery tests remain separate release-environment gates.
- Harness provider execution now passes through the Control Plane EXECUTE policy before Planner, Builder, Reviewer and deterministic verifier processes start.
