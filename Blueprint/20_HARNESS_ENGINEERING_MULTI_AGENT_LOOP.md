# 20 — Harness Engineering / Multi-Agent Autonomous Engineering Blueprint

## 1. Purpose

This document upgrades AECP from a bounded local autonomous worker into a complete AI software-engineering control plane.

The governing model is:

~~~text
GitHub = Engineering Source of Truth
Harness = Control Plane / Orchestrator
Claude Code = Planner / Architect / Reviewer / QA
Codex CLI = Local Builder / Worker
GitHub Actions = Event + CI Validation Backbone
AECP Dashboard = Human Command Center
Human = Final Authority
~~~

OpenAI's published harness-engineering work emphasizes repository legibility, explicit constraints, automated feedback loops, tests, CI, and continuous cleanup as key ingredients for reliable agentic engineering. OpenAI's Symphony work similarly describes an orchestrator that turns a project-management board into a control plane for coding agents. AECP adopts those principles while remaining provider-neutral and Windows/local-first.

## 2. Core architecture

~~~text
                         HUMAN
                           │
                    Goal / Approval
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     AECP DASHBOARD                             │
│ Board │ Queue │ Pipeline │ Agents │ Trace │ Git │ CI │ Evidence │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    AECP HARNESS                                 │
│ State Machine │ Queue │ Scheduler │ Locks │ Policy │ Budgets    │
│ Context │ Dispatch │ Retry │ Timeout │ Recovery │ Evidence      │
└──────────────┬───────────────┬──────────────────┬────────────────┘
               │               │                  │
               ▼               ▼                  ▼
        Claude Code        Codex CLI          Other Adapters
        Planner/Review     Local Worker       Gemini / Local / API
               │               │                  │
               └───────────────┼──────────────────┘
                               ▼
                        Isolated Worktree
                               │
                               ▼
                         Build / Test
                               │
                               ▼
                       Git Commit / PR
                               │
                               ▼
                        GitHub + Actions
                               │
                               ▼
                    CI / Evidence / Events
                               │
                               └──────────→ Harness Loop
~~~

## 3. Separation of responsibilities

### Harness

The Harness never becomes another coding model.

It decides:

- what task is ready;
- which agent role receives it;
- which Workspace/repository is allowed;
- which capabilities are allowed;
- what locks are required;
- maximum iterations;
- timeout;
- retry policy;
- verifier;
- stop condition;
- approval gate;
- recovery behavior;
- evidence required before accepting the result.

### Claude Code

Primary roles:

- Planner
- Architect
- Reviewer
- QA Architect
- Rework diagnostician

Claude Code should operate at the highest useful abstraction level rather than editing every line.

### Codex CLI

Primary roles:

- Local Builder
- Test/Fix Worker
- Repository Explorer
- Optional local Reviewer

Codex CLI is a natural worker boundary because current OpenAI documentation describes local repository inspection/editing/tool execution and automation through codex exec, with project instructions such as AGENTS.md. AECP owns the outer safety envelope; a worker never defines its own completion state.

### GitHub

GitHub stores:

- source code;
- Blueprint;
- plans;
- task artifacts;
- commits;
- branches;
- PRs;
- CI results;
- release artifacts;
- review history.

The local Harness stores live runtime state that is too dynamic to treat GitHub as a database.

### GitHub Actions

Actions provide:

- deterministic CI;
- build;
- test;
- package;
- release;
- external event handling;
- validation callbacks.

AECP may use repository_dispatch and workflow_dispatch as event/control mechanisms, but GitHub Actions is not the low-latency local scheduler.

## 4. Canonical engineering loop

~~~text
BLUEPRINT
   ↓
CLAUDE PLAN
   ↓
PLAN + TASKS
   ↓
HARNESS QUEUE
   ↓
CODEX BUILD
   ↓
LOCAL VERIFY
   ↓
COMMIT / PR
   ↓
GITHUB CI
   ↓
CLAUDE REVIEW
   ├── PASS ─────→ ACCEPT
   ├── REWORK ───→ CODEX
   └── BLOCKED ──→ HUMAN
                     │
                     └──────────────┐
                                    ▼
                               NEXT TASK
~~~

The loop is therefore:

**Claude ↔ Harness ↔ Codex ↔ GitHub/CI**

not Claude ↔ Codex chat spam.

## 5. Task decomposition

A Goal becomes a durable task graph.

~~~text
GOAL-023
  │
  ├─ PLAN-023
  ├─ TASK-023-A  Dashboard UI
  ├─ TASK-023-B  Agent Status API
  ├─ TASK-023-C  Git Status API
  ├─ TASK-023-D  Test Coverage
  └─ REVIEW-023
~~~

Each task contains:

~~~yaml
schema: aecp.task/v2
task_id: TASK-023-B
plan_id: PLAN-023
blueprint_version: v1.x
workspace_id: workspace-alpha
repo_id: control-plane
role: coding-worker

objective: "Implement Git status service"

acceptance:
  - unit_tests_pass
  - lint_pass
  - api_response_valid
  - no_unrelated_files_changed

limits:
  max_iterations: 5
  timeout_minutes: 30
  max_turns: 12

permissions:
  filesystem: workspace-worktree
  network: disabled
  git:
    read: true
    commit: true
    push: false

verification:
  profile: git-service

on_failure:
  - rework
  - human_required
~~~

## 6. State machine

~~~text
INBOX
  ↓
PLANNING
  ↓
READY
  ↓
DISPATCHED
  ↓
RUNNING
  ↓
VERIFYING
 ┌───────┼────────┐
PASS    FAIL     ERROR
 │       │        │
 ▼       ▼        ▼
REVIEW  REWORK   RETRY
 │       │        │
PASS     └────────┘
 │
 ▼
ACCEPTED
 │
 ▼
DONE
~~~

Additional states:

- WAITING_USER
- BLOCKED
- CANCELLED
- TIMEOUT
- BUDGET_EXHAUSTED
- INTERRUPTED
- ROLLED_BACK
- HUMAN_REQUIRED

Only the Harness performs state transitions. Agents may propose outcomes; they cannot assert them.

## 7. Bounded autonomy

Every autonomous run requires:

- max_iterations;
- max_turns;
- timeout;
- max_output;
- max_patch_size;
- max_changed_files where appropriate;
- verifier;
- stop conditions;
- risk policy.

There is never an implicit infinite loop.

## 8. Queue

The queue is a first-class control-plane object.

~~~text
#001 PLAN-023       DONE
#002 TASK-023-A     DONE
#003 TASK-023-B     RUNNING
#004 TASK-023-C     READY
#005 REVIEW-023     WAITING
#006 TASK-024       BLOCKED
~~~

Scheduler decisions consider:

- dependencies;
- locks;
- agent availability;
- provider health;
- Workspace policy;
- priority;
- estimated cost/runtime;
- risk;
- retry budget.

The scheduler must be deterministic enough that the same queue state can be explained after restart.

## 9. Locks

Minimum lock scopes:

~~~text
Workspace
Repository
Worktree
File
External resource
~~~

Default coding rule:

> One write owner per repository/worktree; read-only agents may coexist.

Locks are leases with heartbeat and explicit recovery.

## 10. Git isolation

Coding work should use dedicated branches/worktrees:

~~~text
main
 ├── agent/task-023-a
 ├── agent/task-023-b
 └── review/task-023
~~~

The user's active Workspace remains untouched until an explicit verified integration operation.

## 11. Planner / Worker / Reviewer contract

Planner produces:

- architecture impact;
- task graph;
- dependencies;
- acceptance criteria;
- verifier plan;
- risk classification.

Worker produces:

- files changed;
- commands/tests run;
- test results;
- commit/diff;
- unresolved issues;
- evidence references.

Reviewer produces:

~~~yaml
result: PASS | REWORK | BLOCKED | HUMAN_REQUIRED
findings:
  - severity:
    path:
    evidence:
    required_change:
acceptance:
  blueprint:
  plan:
  tests:
  security:
  architecture:
~~~

## 12. Evidence-first engineering

Every accepted task must have evidence:

~~~text
Task ID
Blueprint version
Plan ID
Agent
Iteration
Base commit
Final commit/diff
Commands
Exit codes
Tests
Verifier result
Review result
Changed-file summary
~~~

Large raw evidence remains local. Dashboard and Context Capsule use compact references/hashes.

## 13. Failure taxonomy

~~~text
ENVIRONMENT
TOOL_UNAVAILABLE
AUTH
PERMISSION
DEPENDENCY
BUILD
TEST
INTEGRATION
ARCHITECTURE
REVIEW
TIMEOUT
BUDGET
LOCK
CONFLICT
STALE_BASE
POLICY_DENIED
HUMAN_DECISION_REQUIRED
~~~

Failures are classified and receive class-specific recovery policies.

## 14. Harness Engineering principles

### Legibility

Agents must discover architecture, conventions, commands, test entry points, ownership, task state and constraints.

### Mechanical enforcement

Important rules become schemas, linters, tests, structural checks, policy and CI gates.

### Progressive disclosure

Expose only context needed for the current task.

### Feedback loops

Every change should have a fast deterministic feedback path where possible.

### Garbage collection

Schedule bounded maintenance tasks:

~~~text
architecture drift scan
dependency hygiene
dead code scan
test-gap scan
documentation drift
large-file scan
security policy scan
~~~

### Repository as agent memory

Durable knowledge lives in Blueprint, AGENTS.md, docs, architecture rules, verification commands and decision records—not in hidden chat history.

## 15. AGENTS.md strategy

Codex supports layered AGENTS.md instruction discovery. AECP should use that capability instead of injecting a giant prompt on every run.

Recommended:

~~~text
AGENTS.md
services/
  AGENTS.md
frontend/
  AGENTS.md
backend/
  AGENTS.md
~~~

Stable engineering constraints belong here. Ephemeral task state belongs in AECP Task/Plan contracts.

## 16. Dashboard as engineering cockpit

The dashboard must show the live control plane, not only chat.

### Overview

~~~text
PROJECT 82%

Planning       100%
Implementation  84%
Testing         79%
Review          72%
Acceptance      63%
~~~

### Agent board

| Agent | Role | Status | Task | Runtime |
|---|---|---|---|---:|
| Claude-01 | Planner | Working | PLAN-023 | 04:31 |
| Codex-01 | Builder | Working | TASK-023-B | 08:42 |
| Claude-02 | Reviewer | Waiting | TASK-023-B | — |
| Harness | Controller | Running | Dispatch | 12:13 |

### Live task

~~~text
TASK-023-B
Implement Git Status API

✓ Read Blueprint
✓ Read Plan
✓ Inspect repository
✓ Modify service
● Running tests
○ Generate Evidence
○ Review
~~~

### Review panel

~~~text
Blueprint       PASS
Architecture   PASS
Implementation PASS
Tests           PASS
Security        WARN
Documentation  PASS

REWORK REQUIRED
Reason: timeout handling missing
~~~

### Git panel

~~~text
branch: agent/task-023-b
commit: a81c4d2
files: 12
+342 -87
CI: ✓ build  ✓ unit  ✗ integration
~~~

## 17. Three sources of truth

### GitHub = engineering truth

Code, Blueprint, commits, PRs, CI and releases.

### Harness DB = runtime truth

Queue, live agent state, locks, heartbeat, current run, retry count, budgets and local execution events.

### Dashboard = human truth

A visual projection of canonical models. It is not an independent state database.

## 18. Event architecture

Canonical events:

~~~text
GoalCreated
PlanCreated
TaskReady
TaskDispatched
AgentStarted
AgentHeartbeat
AgentOutput
VerificationStarted
VerificationFinished
ReviewRequested
ReviewFinished
ReworkRequested
HumanApprovalRequested
HumanApprovalGranted
HumanApprovalDenied
CommitCreated
PushRequested
CIStarted
CIFinished
TaskAccepted
TaskBlocked
TaskCancelled
TaskFailed
~~~

Each event includes event_id, timestamp, task_id, run_id, actor, type, payload, correlation_id and schema_version.

Events are append-only. Current state is a materialized projection.

## 19. GitHub event backbone

Preferred external validation path:

~~~text
Harness
  ↓
push branch / PR
  ↓
GitHub Actions
  ↓
tests/build/security
  ↓
workflow result
  ↓
Harness event adapter
  ↓
REVIEW / REWORK / ACCEPT
~~~

For external repository workflows, repository_dispatch may carry a versioned event type and client payload. AECP must verify correlation before changing local state.

## 20. Multi-agent scheduling

Phase 1:

~~~text
1 Planner
1 Worker
1 Reviewer
~~~

Phase 2:

~~~text
1 Planner
N Workers
N Reviewers
~~~

Parallelism is permitted only when dependency and resource analysis proves tasks do not conflict.

## 21. Human gates

### Gate 1 — Goal / Blueprint

Approve intended outcome.

### Gate 2 — High-risk action

Examples:

- production deploy;
- credential changes;
- destructive deletion;
- force push;
- security policy change;
- payment;
- administrator operation.

### Gate 3 — Bounded loop exhaustion

When budget is exhausted:

~~~text
HUMAN_REQUIRED
reason: 5 iterations exceeded
last failure: TEST-API-007
evidence: ...
~~~

## 22. Cost and throughput control

The Harness records:

- runtime;
- provider;
- model;
- token/cost metadata when available;
- local CPU/GPU time;
- queue wait;
- retry count;
- test time.

For ChatGPT Web, AECP must not scrape hidden usage counters. It may record only local facts such as handoff count and capsule size.

Optimization target:

> maximize verified engineering progress per unit of human attention.

## 23. Provider interchangeability

Stable roles:

~~~text
SUPERVISOR
PLANNER
BUILDER
REVIEWER
RESEARCHER
VERIFIER
LOCAL_COMPUTE
~~~

Mappings can change without changing Task state.

## 24. Security boundary

Never allow AI text to become raw unbounded shell access.

Correct path:

~~~text
AI proposal
   ↓
canonical task
   ↓
policy
   ↓
capability
   ↓
sandbox/worktree
   ↓
verification
   ↓
evidence
~~~

The Harness is the trust boundary.

## 25. Remote/mobile future

A future phone/browser interface submits Goal, Workspace, Task policy and Approval, then receives state, current agent, current step, test result, review, evidence and approval requests.

It must not require ChatGPT Web DOM automation.

## 26. Maturity model

- M0 — Safe Bridge
- M1 — Bounded Local Worker
- M2 — Planner/Worker/Reviewer
- M3 — Multi-Agent Queue
- M4 — Event-Driven Engineering OS
- M5 — Self-maintaining Agent Repository

## 27. Acceptance criteria

The implementation must eventually demonstrate:

1. Goal becomes durable Plan and Task graph.
2. Harness dispatches a task without manual copy/paste between Claude and Codex.
3. Worker executes only inside an authorized isolated worktree.
4. Verifier independently decides pass/fail.
5. Failure can produce bounded rework.
6. Reviewer sees Blueprint + Plan + Diff + Evidence.
7. Reviewer returns PASS/REWORK/HUMAN_REQUIRED.
8. Queue dispatches the next eligible task.
9. Conflicting write tasks are blocked by locks.
10. GitHub CI results return as correlated events.
11. Dashboard shows canonical Harness state.
12. Restart recovers or safely interrupts in-flight tasks.
13. No loop runs without finite budget/timeout.
14. No agent can grant itself permissions.
15. Human approval protects configured high-risk operations.
16. Provider can be changed without rewriting Task state.
17. Official ChatGPT Web remains untouched.
18. External API providers can be attached later through adapters.
19. Repository knowledge is legible to agents.
20. Every accepted task has reproducible evidence.

## 28. Design conclusion

> **AECP is a local-first control plane that turns AI reasoning into governed, observable, testable and recoverable software engineering.**

The model supplies intelligence. The Harness supplies discipline. Git supplies history. CI supplies deterministic validation. Dashboard supplies visibility. The human remains the final authority.


## 29. Implementation status — 2026-09-19

The Planner → Queue → Builder → Verify → Reviewer loop is now a real bounded runtime rather than a design-only concept. It has durable task state, leases, heartbeat, recovery, evidence, policy/locks, GitHub delivery and CI feedback. CI failure can automatically return a task to bounded rework; CI success can advance it toward a human approval gate.

The remaining work is hardening: authenticated external event correlation, complete crash-safe resume, multi-repository scheduling, full adapter policy enforcement and E2E validation.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.
