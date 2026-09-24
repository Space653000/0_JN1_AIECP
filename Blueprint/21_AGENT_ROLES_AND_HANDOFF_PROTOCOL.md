# 21 — Agent Roles and Handoff Protocol

## 1. Purpose

Define a vendor-neutral protocol so Claude Code, Codex CLI, Gemini CLI, local models, API providers and future agents cooperate without sharing hidden sessions.

## 1A. Worker identity is separate from engineering role

Planner / Builder / Reviewer remain stable roles. A Worker is the concrete runtime identity selected to perform a role.

Examples:

```text
role: Builder
worker: codex-official
provider: openai-official

role: Builder
worker: codex-pega
provider: pega
```

Role handoff schemas must not encode PEGA/OpenAI-specific state. Worker handoff includes only canonical worker/provider/model/task/worktree/evidence identifiers. Auth/session/CODEX_HOME internals are never passed between workers.

## 2. Stable roles

| Role | Responsibility | May write code? |
|---|---|---:|
| Supervisor | Goal, priority, approval | No |
| Planner | Architecture and task decomposition | No by default |
| Researcher | Evidence gathering | No |
| Builder | Implementation | Yes, isolated only |
| Reviewer | Diff/architecture/quality review | No by default |
| Verifier | Deterministic tests | No |
| Maintainer | Cleanup/refactoring | Yes, isolated |
| Local Compute | indexing/OCR/RAG/log reduction | Scoped |
| Harness | dispatch/state/policy | Not model-driven |

## 3. Handoff artifacts

~~~text
Goal Contract
Plan Contract
Task Contract
Context Capsule
Command Card
Worker Report
Evidence Bundle
Review Report
Result Capsule
~~~

No provider may depend on another provider's private conversation/session ID.

## 4. Goal Contract

~~~yaml
schema: aecp.goal/v1
goal_id:
title:
objective:
definition_of_done:
constraints:
priority:
workspace_id:
risk_policy:
requested_by:
~~~

## 5. Plan Contract

~~~yaml
schema: aecp.plan/v1
plan_id:
goal_id:
blueprint_version:
architecture_summary:
tasks:
  - task_id:
    objective:
    dependencies:
    acceptance:
    verifier:
    risk:
~~~

## 6. Worker Report

~~~yaml
schema: aecp.worker-report/v1
task_id:
run_id:
agent:
iteration:
base_commit:
changed_files:
commands:
tests:
result:
unresolved:
evidence_refs:
~~~

## 7. Review Report

~~~yaml
schema: aecp.review/v1
task_id:
reviewer:
result: PASS | REWORK | BLOCKED | HUMAN_REQUIRED
blueprint:
plan:
implementation:
tests:
security:
architecture:
findings:
required_changes:
~~~

## 8. Context Capsule

Contains only the minimum necessary context:

~~~text
Goal
Task
Blueprint constraints
Relevant architecture
Relevant files
Current Git state
Previous failure
Verifier output
Required decision
~~~

## 9. Result Capsule

~~~text
Task
State
What changed
Tests
Review
Git
Evidence
Remaining issue
Next recommended action
~~~

## 10. Handoff rules

1. Every handoff includes schema version.
2. Every handoff includes Task/Run correlation IDs.
3. Evidence references are immutable.
4. Sensitive values are redacted.
5. A provider cannot change another provider's permissions.
6. A review result is not an execution command.
7. A worker report is not proof of completion until verifier evidence exists.
8. A Result Capsule never silently claims unverified success.

## 11. Role substitution

~~~text
Claude Planner
      ↓
Codex Builder
      ↓
Claude Reviewer
~~~

can become:

~~~text
ChatGPT Planner
      ↓
Codex Builder
      ↓
Gemini Reviewer
~~~

without changing the Task schema.

## 12. Human-readable trace

~~~text
09:14 Planner created PLAN-023
09:16 Harness created TASK-023-B
09:17 Codex started isolated worktree
09:25 Codex changed 6 files
09:27 Tests failed: 2
09:31 Codex iteration 2
09:34 Tests passed
09:35 Claude review requested
09:37 Review: REWORK
09:38 Harness returned task to Codex
~~~

This is the primary observability contract for beginners.


## 13. Runtime status — 2026-09-22

The role contracts are now backed by a Provider Router foundation and the Control Plane uses Planner/Builder/Reviewer roles without making vendor identity part of Task state. Worker reports and evidence are persisted; reviewer outcomes drive bounded state transitions.

A provider may be substituted without changing the task contract. Adapter-level policy coverage and deterministic integration tests are now part of canonical verification; real provider-specific production claims still require the corresponding actual runtime/credentials/environment.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.


## Blueprint owner decision D4 — 2026-09-24 (append-only)

A Review Report (`aecp.review/v1`) result of `BLOCKED` is handled as a `HUMAN_REQUIRED` gate with the reason recorded; it never advances a task automatically. A missing, malformed or schema-invalid Review Report is `HUMAN_REQUIRED`, never `PASS`. The Reviewer must receive the Blueprint reference, the full Plan, the actual bounded diff content and the verification evidence (see `20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md` §27 item 6).
