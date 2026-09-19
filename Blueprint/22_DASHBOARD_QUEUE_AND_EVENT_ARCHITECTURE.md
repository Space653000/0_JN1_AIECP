# 22 — Dashboard, Queue and Event Architecture

## 1. Goal

Make the entire engineering loop visible in one beginner-friendly dashboard without turning the UI into a second chat application.

## 2. Default screen

~~~text
┌──────────────────────────────────────────────────────────────┐
│ AI Engineering Control Plane                                │
│ Project ▼   ● Healthy   Queue 6   Agents 3   CI 2          │
├──────────────┬──────────────────────────┬───────────────────┤
│ WORKSPACE    │ ENGINEERING BOARD        │ OFFICIAL CHATGPT  │
│              │                          │                   │
│ Repo         │ PLAN-023                 │ Open official    │
│ Branch       │ ├─ A ✓                   │ ChatGPT Web      │
│ Git status   │ ├─ B ● Codex             │                   │
│ Tools        │ ├─ C ○                   │ No injected UI   │
│              │ └─ Review ○              │                   │
├──────────────┴──────────────────────────┴───────────────────┤
│ CURRENT RUN                                                   │
│ Codex-01 · TASK-023-B · Iteration 2 · 00:12:31               │
│ ✓ inspect  ✓ edit  ● pytest  ○ evidence  ○ review           │
├──────────────────────────────────────────────────────────────┤
│ EVIDENCE │ DIFF │ TESTS │ REVIEW │ LOG │ GIT │ EVENTS       │
└──────────────────────────────────────────────────────────────┘
~~~

## 3. UX modes

### Beginner

Shows project, current task, progress, agent, explanation, Start/Pause/Cancel, Approve and View Result.

### Engineering

Adds queue, state machine, locks, worktrees, provider, model, command, process, logs, Git diff, CI, evidence and policy.

## 4. Queue view

Columns:

~~~text
READY
RUNNING
VERIFYING
REVIEW
WAITING
BLOCKED
DONE
~~~

Task card:

~~~text
TASK-023-B
Implement Git Status API

Agent: Codex-01
Iteration: 2/5
Runtime: 12:31
Risk: YELLOW
Lock: repo-control-plane
Verifier: git-service
CI: pending
~~~

## 5. Agent view

Each agent card shows:

~~~text
Claude-01
Role: Reviewer
State: WAITING
Task: TASK-023-B
Health: READY
Provider: Claude Code
Version: detected
Workspace: control-plane
~~~

No fake status is allowed. If the process cannot be verified, show UNKNOWN.

## 6. Run timeline

~~~text
09:17 START
09:18 PREPARE
09:19 WORKER
09:25 TEST
09:27 FAIL
09:28 REWORK
09:34 PASS
09:35 REVIEW
09:37 REWORK
~~~

Clicking an event opens evidence.

## 7. Diff view

Display changed files, additions/deletions, untracked files, patch size, base commit, current commit and verifier status.

## 8. Review view

Review is structured:

~~~text
Blueprint      PASS
Plan           PASS
Implementation PASS
Tests          PASS
Security       WARN
Architecture   PASS

Result: REWORK
~~~

## 9. GitHub view

Display:

- branch;
- base;
- commit;
- PR;
- CI status;
- workflow;
- artifacts;
- release;
- last event.

## 10. Event stream

~~~text
✓ TASK-023-B dispatched to Codex
✓ isolated worktree created
● pytest running
✗ 2 tests failed
↻ iteration 2 started
✓ tests passed
→ review requested
~~~

Every UI event maps to an immutable Harness event.

## 11. Notifications

- INFO — task progress
- SUCCESS — task accepted
- WARNING — provider degraded / retry
- ACTION REQUIRED — approval
- ERROR — task failed
- CRITICAL — policy/security violation

Do not notify on every model token.

## 12. Mobile-ready design

Desktop Dashboard exposes a compact read-only representation suitable for a future authenticated remote supervision gateway.

Remote commands remain a future capability and inherit local policy.

## 13. Event retention

Keep current task state, recent events, immutable run summaries and evidence references. Large logs/artifacts may be compressed or rotated locally.

## 14. Performance

Prefer:

~~~text
Harness event
 ↓
local event bus
 ↓
materialized UI state
 ↓
renderer update
~~~

Polling is reserved for external systems that provide no event mechanism.

## 15. Accessibility

Required:

- keyboard navigation;
- visible focus;
- text equivalents for status icons;
- no color-only status meaning;
- scalable font;
- screen-reader labels;
- reduced-motion option.

## 16. Acceptance

A novice should answer within one screen:

1. What project am I controlling?
2. What is being worked on?
3. Which agent is doing it?
4. Is it running, waiting or failed?
5. What is the current test result?
6. What changed?
7. Does it need me?
8. What happens next?


## 17. Runtime status — 2026-09-19

The Harness Command Center is implemented as a live projection of the durable Control Plane. It currently exposes mission metrics, queue state, approvals, task state, PR/CI status, pause/resume/cancel, emergency STOP ALL and a journaled event stream. Delivery approval is explicitly separated from normal task approval and requires CI success plus human approval.

The Dashboard remains a projection: canonical runtime state lives in the Control Plane, engineering truth remains GitHub, and event/evidence records provide replayable history.

Future dashboard work is limited to deeper GitHub projection, mobile read-only supervision, accessibility hardening and richer evidence/artifact inspection.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.
