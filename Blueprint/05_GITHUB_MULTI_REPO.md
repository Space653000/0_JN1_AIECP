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

### Level 2 — GitHub API adapter (future)

OAuth/GitHub App/token integration with scoped permissions. Credentials live in secure storage and actions are capability-limited.

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

## 5. Worktree-per-task direction

Coding tasks should eventually default to:

`repo/.aecp-worktrees/<task-id>` or a configurable external worktree root.

Benefits:
- parallel tasks do not edit the same checkout;
- branch identity is explicit;
- rollback/cleanup is easier;
- user main workspace remains undisturbed.

Bootstrap release may operate in-place only after showing Git clean/dirty state and requiring approval for writes.

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

Write lock granularity: repository. Read tasks can share. Cross-repo tasks acquire all write locks before mutation or fail fast with `BLOCKED`.

## 8. GitHub project/issue relationship

Optional future integration can link Task ID ↔ issue/PR/project item. AECP's canonical task state remains local; GitHub is a synchronized external projection, not the only source of truth.

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