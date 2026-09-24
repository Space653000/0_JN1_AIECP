# 05 — GitHub and Multi-Repository Architecture

## 1. Principles

GitHub is a first-class resource provider, but local Git operation must continue to work without GitHub authentication. A Workspace may bind zero, one, or many repositories/remotes/accounts.

## 2. Resource model

```text
Workspace
├─ LocalRepo A
│  ├─ remote origin → GitHub Repo A
│  └─ branch main
├─ LocalRepo B
│  ├─ remote origin → GitHub Repo B
│  └─ branch develop
└─ LocalRepo C (no remote)
```

AECP detects local repositories first. Remote identity is derived from `git remote -v` and normalized for display; credentials are never parsed from URLs into logs.

## 3. GitHub account integration levels

### Level 0 — Local Git only

No GitHub credentials required.

### Level 1 — GitHub CLI bridge

If `gh` is installed/authenticated, AECP may offer explicit operations through `gh`, always respecting risk policy.

### Level 2 — Optional direct GitHub API adapter

The canonical governed delivery path currently uses authenticated Git/`gh` primitives plus signed webhook/CI correlation. A future direct OAuth/GitHub App adapter is optional rather than required; if added, credentials must remain securely stored and every action capability-limited.

## 4. Multi-repo task

A Task declares a set of resource bindings:

```json
{
  "repos": [
    {"id":"frontend","mode":"write"},
    {"id":"backend","mode":"write"},
    {"id":"docs","mode":"read"}
  ]
}
```

Harness acquires locks in deterministic sorted order to avoid deadlocks.

## 5. Worktree-per-task execution

Governed coding tasks use isolated worktrees, with a task-scoped worktree root managed by the Harness rather than mutating the user's main checkout directly.

Benefits:
- parallel tasks do not edit the same checkout;
- branch identity is explicit;
- rollback/cleanup is easier;
- user main workspace remains undisturbed.

Safe Bridge/read-only inspection may use the selected checkout directly. Governed Builder mutation uses the isolated worktree path and re-validates source HEAD/dirty state before applying verified changes.

## 6. Git operation risk

GREEN:
- status
- branch current
- diff read
- log
- remote read

YELLOW:
- branch/worktree create
- add
- commit
- stash

RED:
- push
- force push (default deny)
- tag/release
- remote mutation
- history rewrite

## 7. Concurrency

Write lock/resource ownership is enforced by Harness/Resource Manager/Lock Manager. Read tasks may share. Cross-repo tasks acquire required write locks in deterministic order or fail fast with `BLOCKED`.

For the OFFICIAL/PEGA Multi-Worker extension:

- two independent tasks may run concurrently in the same repository only through **different isolated Git worktrees**;
- `codex-official` and `codex-pega` must never be assigned the same mutating worktree concurrently;
- Worker identity does not weaken repository locking;
- each task records its Worker, branch, base commit and worktree;
- cancelling one task removes only that task's runtime/lock ownership;
- STOP ALL may revoke all active Worker leases.

## 8. GitHub project/issue relationship

Optional issue/Project-item synchronization may be added later, but it is not part of the normative engineering loop. Current governed delivery links Task/Run state to branch, Draft PR, commit SHA and CI evidence; GitHub remains engineering Source of Truth while Harness owns runtime queue/locks/heartbeats.

## 9. Evidence

Per repo capture:
- current branch/HEAD
- clean/dirty before
- file-change summary after
- `git diff --stat`
- commit hash if created
- remote target if publishing was approved


## 10. GitHub as event backbone

GitHub is both engineering Source of Truth and an asynchronous event source. Harness may publish branches/PRs and consume CI/repository events through a dedicated adapter.

`repository_dispatch` may carry a versioned AECP event and correlation IDs; `workflow_dispatch` may provide controlled manual runs. The Harness remains the runtime source for queue/locks/heartbeats and must correlate external events before changing task state.

## 11. Agent branch convention

```text
agent/<task-id>
review/<task-id>
maintenance/<task-id>
```

Branch/worktree identity is part of Task evidence.

## 12. Multi-agent scheduling

Parallel work is allowed only after dependency/resource analysis. Repository write conflicts must be blocked by Harness locks before a Worker starts.