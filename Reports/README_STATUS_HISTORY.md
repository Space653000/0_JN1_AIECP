# README status history

來源：`README.md`，於 2026-09-24 依施工單 0001 搬移。以下兩段保留搬移前文字；目前進度以 [`.ai/STATUS.md`](../.ai/STATUS.md) 為準。

<!-- BEGIN VERBATIM: README top V3 progress -->
## V3.0 Multi-Worker progress

The current V3.0 architecture keeps **one AECP** and adds isolated, replaceable Builder Workers behind the existing Harness:

```text
AECP
 ↓
Harness / Control Plane
 ├─ Codex OFFICIAL Worker → isolated CODEX_HOME
 ├─ Codex PEGA Worker     → isolated CODEX_HOME
 ├─ Claude Code Planner / Reviewer
 └─ future Provider / Worker
```

Repository/runtime implementation, deterministic tests, real-provider environment evidence, and OWNER/EXTERNAL production trust are tracked separately. The detailed ledger is:

**[Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md](Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md)**

The Command Center also exposes a **V3.0 Multi-Worker Readiness** panel. Real OFFICIAL/PEGA execution is never shown as complete from source tests alone; it remains an **ENVIRONMENT GATE** until exact-source self-hosted Windows evidence exists.

<!-- END VERBATIM: README top V3 progress -->

<!-- BEGIN VERBATIM: README appended status -->
# Status

This repository is an active preview. The repository-verifiable stable-release gates now include canonical Harness/provider routing, migration/update/rollback tests, accessibility/security audits, Store software packaging and signed-release software preparation. A `1.0.0` production-trust claim remains blocked until owner-controlled Authenticode credentials/signing and Microsoft Store publisher/certification requirements are actually satisfied.


# Blueprint / Architecture

The **Blueprint is the product source of truth**. The complete architecture is now consolidated into `Blueprint/`, including the Harness engineering expansion:

- `20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md` — Planner → Queue → Worker → Verify → CI → Reviewer → Rework/Accept, bounded autonomy, scheduler/locks/recovery.
- `21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md` — vendor-neutral Supervisor/Planner/Builder/Reviewer/Verifier roles and versioned handoff contracts.
- `22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md` — Board/Queue/Agents/Trace/Git/CI/Evidence dashboard, event stream and mobile-ready supervision model.

### What is designed vs. what is implemented

**Blueprint complete:** the target end-state architecture, contracts, security boundaries, UX, event model, multi-repo model, provider abstraction, autonomous loop and acceptance gates are documented.

**Implementation is staged but the governed core loop is now implemented:** v0.3.0 Preview includes the safe bridge, durable Mission/Task scheduler, dependency/resource routing, bounded parallel execution, isolated worktrees, Planner → Builder → deterministic Verify → Reviewer, evidence, governed GitHub branch/commit/push/Draft PR delivery, CI feedback/rework, signed webhook ingestion and human-gated merge. Remaining gates are release trust, real provider/environment evidence, and deliberately restricted remote/public capabilities—not a redesign of the core loop.

### Canonical end-state loop

```text
Goal / Blueprint
      ↓
Planner (Claude / replaceable provider)
      ↓
Durable Task Queue
      ↓
Harness Scheduler + Policy + Locks
      ↓
Builder Worker (Codex / replaceable provider)
      ↓
Deterministic Verify
      ↓
Git / PR / GitHub Actions
      ↓
Reviewer (Claude / replaceable provider)
   ├─ PASS → ACCEPT → next task
   ├─ REWORK → Builder
   └─ HUMAN_REQUIRED → user approval
```

The Harness owns state, permissions, budgets, retries, timeouts, evidence and recovery. A model never grants itself permission or declares technical completion by itself.

### Current release truth

Do not treat Blueprint roadmap items as installed features. The **Complete Feature Map** below is the authoritative v0.3.0 Preview status table. Future features must pass the Blueprint acceptance gates before being marked implemented.


## Control Plane Hardening (current branch)

The current hardening stage adds the runtime infrastructure required for a governed engineering operating system:

- **SecurityPolicy** — GREEN/YELLOW/RED action classification and approval gates.
- **LockManager** — durable workspace/repository leases with recovery after expiry.
- **EvidenceManager** — hashed evidence files and manifests.
- **ContextBus** — bounded, expiring Context/Result Capsules so large repositories and logs do not flow through model prompts.
- **ProviderRouter** — role-based provider selection for Claude, Codex, Gemini, OpenCode and Ollama without making the control plane vendor-dependent.
- **GitHubGateway** — authenticated branch/commit/push/Draft PR/check/workflow primitives used by the governed delivery loop; merge remains explicit human approval.
- **CI/security workflows** — deterministic verification and dependency/security checks.
- **Mission activation** — automatic planner decomposition is now part of mission creation; a mission does not enter execution without a generated task plan.
- **Workspace locking** — concurrent tasks cannot silently mutate the same workspace at the same time.
- **Evidence + capsules** — completed tasks publish bounded result evidence for dashboard/review layers.

The system still deliberately refuses to make high-risk operations autonomous by default. Push, merge, delete, credential and system-level actions remain approval-gated. This is a safety property, not a missing feature.


# Current Engineering Status — 2026-09-22

> **Implementation truth:** AECP is now a working governed Control Plane prototype. The Blueprint and runtime have been synchronized to the same architecture. A roadmap item is not marked complete until code and verification exist.

## What is implemented now

- Durable Mission / Task state and bounded scheduler.
- Planner-driven Task decomposition with dependencies.
- Isolated task worktrees, leases, heartbeat and restart recovery.
- Planner → Builder → deterministic Verify → Reviewer loop.
- Bounded REWORK loop with iteration limits and timeouts.
- GREEN / YELLOW / RED security policy foundation with actual Builder write enforcement.
- Durable workspace/task locks.
- Evidence hashing, manifests, event journal and replay API.
- Bounded Context Bus / Context Capsules.
- Role-based Provider Router foundation for Claude, Codex, Gemini, OpenCode and Ollama.
- GitHub gateway and governed agent/<task-id> delivery branch.
- Idempotent Draft PR creation across retries.
- GitHub Actions CI monitoring tied to commit SHA.
- CI failure → bounded Task REWORK; CI success → approval gate.
- Human-gated PR merge; merge is blocked without CI PASS + explicit human approval.
- Live Harness Command Center with Mission Queue, Task Board, Approval Queue, PR/CI state, event stream and STOP ALL.
- Guided Goal Loop presets for Research / Build / Debug / Review / Optimization / Release, with editable Goal/Done/budget values and unchanged approval boundaries.
- CI and security workflows plus automated syntax/unit/infrastructure verification.
- Canonical verification includes R1–R8 requirements coverage, Blueprint 00–24 evidence coverage, and phase-by-phase P0–P7 roadmap-gate coverage; artifacts are retained by CI.

## Current truth / important limitation

Workflow status is never frozen into this README. For every change, **AECP CI + AECP Security + AECP Packaging must be read from GitHub Actions for the exact PR HEAD**; documentation alone never promotes a build to PASS.

The current implementation is not yet production-complete. The core control-plane architecture is established; remaining work is evidence, release trust and intentionally gated external capabilities rather than redesigning the core concept.

## Remaining work

### P0 — Production correctness
- crash-safe bounded resume, idempotent event handling, PR reuse, CI log evidence and canonical deterministic E2E are implemented;
- adapter security is covered by the explicit audit matrix and runtime policy gates;
- remaining proof is exact-HEAD CI plus environment-specific real-provider/release evidence where credentials or external trust are required.

### P1 — Multi-repository engineering
- task-to-repository resource graph — implemented;
- per-repository/worktree scheduling and locks — implemented;
- cross-repo dependency handling — implemented through task dependencies and repository-per-task execution;
- GitHub repository/branch/PR state projection — implemented in delivery/task state.

### P2 — Event-driven integration
- event deduplication/idempotency ledger — implemented;
- signed GitHub webhook receiver — implemented and opt-in via secret;
- commit-SHA CI polling and failed-log evidence — implemented;
- authenticated signed GitHub webhook receiver — implemented and opt-in; commit-SHA polling remains the safe fallback when no external webhook transport is configured.

### P3 — Operations
- bounded maintenance/garbage-collection scheduler — implemented;
- expired lock/capsule recovery — implemented;
- evidence retention — implemented;
- orphan worktree cleanup plus dependency/security/Blueprint/documentation drift scans — implemented as bounded maintenance diagnostics; they do not silently mutate dependencies or documentation.

### P4 — Distribution
- x64, ARM64 and universal-bootstrap build plus Windows-runner install/uninstall smoke gates are implemented in repository CI; exact-HEAD Actions determine PASS;
- updater SHA-256 validation, durable transaction state, first-boot reconciliation, retained rollback, and backup/restore are implemented and tested;
- Packaging CI performs real x64/ARM64 baseline → upgrade → rollback smoke tests;
- Store AppX x64/ARM64 software packaging + manifest validation and owner-identity bundle preparation are implemented;
- stable/signed updater builds support pinned Authenticode signer verification for both target and rollback installers;
- the signed-release workflow builds/verifies signed x64/ARM64/Universal artifacts and provenance when owner certificate secrets are supplied;
- **actual production certificate ownership/signing authorization and Microsoft Store Partner Center submission/certification remain EXTERNAL OWNER GATE operations.**

### P5 — Remote supervision
- authenticated loopback gateway, one-time pairing, READ_ONLY and APPROVAL_ONLY scopes, device revocation, request-id replay safety and TLS requirement for non-loopback binding are implemented;
- APPROVAL_ONLY devices may decide only existing approval requests and cannot submit tasks;
- public Internet deployment/domain/device identity remains an EXTERNAL OWNER GATE; no public inbound port is enabled by default.

For the complete maturity matrix, decisions, non-goals and ordered backlog, see Blueprint/23_IMPLEMENTATION_STATUS.md.

## Source-of-truth rule

- **GitHub:** engineering truth — code, Blueprint, commits, PRs, CI and releases.
- **Control Plane runtime:** runtime truth — queue, locks, heartbeats, budgets, current execution and local events.
- **Command Center:** human-facing projection — never an independent state database.

When these disagree, do not guess. Reconcile them through the event/state model and update the Blueprint if the architecture has changed.


## Current closure rule

The core AECP engineering loop and the repository-verifiable distribution/update lanes are now considered **implemented and hardened prototype-complete**. Remaining items are external integration/trust operations or deliberately gated remote capabilities. Microsoft Store publication/certification and production code-signing require user-owned publisher identity/certificates; real provider-specific production claims require their actual local/company/provider environment. Repository code cannot legitimately manufacture those credentials or environments.


## Optional GitHub webhook hardening

AECP includes a signed inbound GitHub webhook receiver. It is disabled by default. To enable the software-side receiver, configure the process environment with `AECP_GITHUB_WEBHOOK_SECRET` and optionally `AECP_GITHUB_WEBHOOK_PORT`. The receiver binds to loopback by default, verifies `X-Hub-Signature-256`, assigns a delivery idempotency key from `X-GitHub-Delivery`, and sends the event through the Control Plane event ledger. Exposing it to GitHub requires a user-owned authenticated tunnel or GitHub App/webhook endpoint; AECP never opens a public inbound port automatically.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.


## Current implementation truth — 2026-09-19

### Completed in the current Control Plane branch

- durable Mission/Task scheduler with leases, heartbeat and restart recovery;
- Planner → Builder → Verify → Reviewer bounded loop;
- repository discovery and task-to-repository routing;
- per-repository/worktree locks and isolated execution;
- GitHub branch + idempotent Draft PR delivery;
- CI monitoring, bounded CI-driven rework and failed-log evidence;
- explicit human gate before governed merge;
- signed GitHub webhook receiver with delivery-id replay protection (opt-in);
- event ledger/replay, Context Capsule TTL and maintenance/garbage collection;
- local authenticated read-only supervision gateway;
- x64/ARM64/Universal release workflows, Store AppX dry-run packages, SHA-256/provenance artifacts, and x64/ARM64 upgrade/rollback smoke evidence;
- live Harness Command Center and synchronized Blueprint/status documentation.

### Remaining engineering / owner gates

1. **Final exact-HEAD verification:** AECP CI + Security + Packaging + release dry-run evidence must pass after the final source/documentation commit.
2. **Real provider/environment evidence:** actual Ollama/OpenCode/company C++ worker or third-party provider production claims require the corresponding real environment/credentials; deterministic adapter tests do not substitute for those claims.
3. **Production trust:** Authenticode certificate ownership/secrets, owner-authorized signing run, Microsoft Store publisher identity/submission/certification and private-audience acquisition remain EXTERNAL OWNER GATE.
4. **Optional public/LAN deployment:** user-owned domain/device identity/TLS configuration remains EXTERNAL OWNER GATE; remote task submission remains intentionally disabled.
5. **Windows UI boundary:** read-only general-app inspection is implemented, browser/ChatGPT inspection is deny-by-default, and state-changing docking requires SYSTEM approval.

**Important:** GitHub Actions is the verification authority for the current branch. Documentation is not used to mark a build as passed; only successful exact-HEAD runs do that. The canonical evidence bundle includes `requirements-coverage.json`, `blueprint-coverage.json`, `roadmap-gates.json`, license audit output and the verification log.


## Production-gate closure status

The six previously identified repository-verifiable production gates are now implemented in code/tests/workflows: Failure Recovery Assistant, Adapter Security Audit Matrix, clean temporary-repository E2E, Windows x64/ARM64 install + upgrade/rollback verification, authenticated remote pairing, and scheduled dependency/security/Blueprint/documentation drift scans. Their completion is accepted only from successful GitHub Actions on the exact commit; external trust/provider-environment gates remain separate.


### Latest implementation update
The bounded Failure Recovery Assistant is now in the runtime path: transient/deterministic failures receive a constrained rework recommendation; credential, permission, policy, production and unknown failures remain HUMAN_REQUIRED. It never executes arbitrary remediation.


### Autonomous maintenance hardening — 2026-09-19

The maintenance loop now includes a bounded, non-mutating Blueprint/documentation drift scanner. It checks the authoritative Blueprint/README/status files and emits findings into maintenance results; it does not silently rewrite project documentation. This is a diagnostic gate, not a claim of production readiness.
<!-- END VERBATIM: README appended status -->
