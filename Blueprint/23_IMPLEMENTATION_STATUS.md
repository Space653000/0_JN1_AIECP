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
| Full crash-safe substep resume | Partial |
| Full multi-repository routing | Partial |
| Complete GitHub event/webhook/event-bus integration | Partial |
| Full security enforcement across every adapter | Partial |
| Mobile authenticated supervision | Not implemented |
| Windows UI automation | Not implemented |
| Public/remote MCP gateway | Not implemented |
| Private Store distribution | Not implemented |
| One-click production-grade updater | Partial |
| Full integration/E2E test suite | Partial |
| Maintenance / garbage collection automation | Partial |

## 5. Remaining work — ordered by engineering dependency

### P0 — Make the current loop production-correct
- Finish crash-safe phase persistence and resume.
- Make CI state transitions idempotent.
- Persist correlation IDs and idempotency keys for external events.
- Ensure PR rework updates the existing PR rather than creating duplicates.
- Add complete GitHub workflow/job/log evidence ingestion.
- Add integration tests using temporary Git repositories.
- Verify every high-risk adapter path through SecurityPolicy.

### P1 — Multi-repository engineering
- Resource graph bindings for tasks.
- Per-repository locks.
- Multiple worktrees/repositories in one mission.
- Cross-repo dependency scheduling.
- GitHub repository routing.
- Branch/PR state projection into Dashboard.

### P2 — Event-driven Control Plane
- Authenticated GitHub webhook/repository_dispatch receiver.
- Event signature verification.
- Correlation and replay protection.
- External event deduplication.
- Replace polling where an authoritative event exists.
- Materialized event projection.

### P3 — Maintenance / self-healing
- Expired lease cleanup.
- Evidence/artifact retention policy.
- Orphan worktree cleanup.
- Failed-run recovery assistant.
- Dependency/security/documentation drift scans.
- Scheduled maintenance tasks with bounded budgets.

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
