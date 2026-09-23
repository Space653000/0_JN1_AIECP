# 18 — Bounded Autonomous Execution

## 1. Goal

v0.3 turns Local Autonomous from a routing concept into an actual governed execution loop.

The product objective is:

```text
ChatGPT Web defines Goal + Done
        ↓
AECP creates isolated Git worktree
        ↓
bounded worker edits the isolated copy
        ↓
AECP runs deterministic verification
        ↓
FAIL → next bounded iteration
PASS → generate verified patch
        ↓
user explicitly presses Apply
        ↓
patch is applied to the real Workspace
```

The active Workspace is not modified while the loop is running.

---

## 2. Safety model

### 2.1 Git-root requirement

v0.3 requires the selected Workspace itself to be a Git repository root.

Why:
- exact base commit can be recorded;
- isolated worktree can be created without copying arbitrary directories;
- source Workspace can remain untouched;
- final changes can be represented as a patch.

### 2.2 Clean source requirement

Autonomy starts only when:

```text
git status --porcelain == clean
```

If the Workspace already contains uncommitted changes, the user must first commit, stash, or discard them.

This prevents AECP from silently mixing autonomous output with unrelated manual edits.

### 2.3 Detached worktree

AECP creates:

```text
<AECP user data>/autonomy/runs/<run-id>/worktree
```

using:

```text
git worktree add --detach <worktree> <base-head>
```

The Worker edits that worktree, not the active checkout.

### 2.4 Worker authority

A worker is not the policy engine.

AECP owns:
- Workspace source binding;
- base HEAD;
- worktree path;
- max iterations;
- per-iteration timeout;
- verifier profile;
- cancellation;
- final patch generation;
- apply gate.

---

## 3. Worker adapters

### OpenCode — default recommendation

OpenCode is preferred when available because it can be used with local models.

v0.3 runs it non-interactively and supplies an inline deny-first policy.

Allowed:
- read
- edit/write/patch inside active worktree
- glob
- grep
- read-only `git status` / `git diff`

Denied:
- external directories
- arbitrary shell
- web fetch/search
- subagents/tasks
- doom-loop escalation

OpenCode v1 and v2 permission schema differences are handled separately.

The inline runtime config has the highest configuration priority so project-level OpenCode configuration cannot silently widen AECP's autonomous permissions.

### Codex CLI — secondary supported worker

Codex uses:

```text
codex exec
--ephemeral
--ignore-user-config
--ignore-rules
--sandbox workspace-write
--json
--cd <worktree>
-c sandbox_workspace_write.network_access=false
```

This keeps model-generated execution in Codex workspace-write sandbox and disables sandbox network access.

### Codex Multi-Worker profile isolation

The broader Control Plane may run multiple Codex Builder Workers concurrently, but bounded autonomy must preserve the same safety envelope.

Initial canonical Codex Worker identities are:

```text
codex-official → OpenAI Official → dedicated CODEX_HOME
codex-pega     → PEGA            → dedicated CODEX_HOME
```

Rules:

- Worker identity is separate from Provider identity and Builder role.
- OFFICIAL and PEGA never share `CODEX_HOME`, auth/session/runtime state or task worktree.
- A task receives one explicit Worker assignment from Harness/Control Plane.
- Same-repository parallel tasks use different isolated Git worktrees.
- Worker/provider network and credential use remain approval-gated.
- Task-scoped cancel must not cancel unrelated Workers.
- Deterministic verification, patch budgets, evidence and human delivery gates remain authoritative regardless of Worker/provider.
- Real OFFICIAL/PEGA endpoint execution is an ENVIRONMENT claim and cannot be promoted from mock/unit tests.

### Claude Code / Gemini CLI

Both remain detected launchable agents, but v0.3 does not mark them as autonomous-write workers yet.

Reason:
- AECP needs equivalent deterministic sandbox/permission behavior before enabling them in the bounded write loop.

They can be added later behind the same adapter contract without changing Goal/Done/Evidence.

---

## 4. Verification profiles

v0.3 does not allow a Worker to decide whether its own work passed.

AECP runs one fixed profile after every successful Worker iteration:

- `npm run verify`
- `npm test`
- `python -m pytest -q`
- `python -m unittest`

AECP automatically recommends:
1. `npm run verify` when `package.json` contains a `verify` script;
2. otherwise `npm test` when a test script exists;
3. otherwise pytest when common Python test configuration is found.

The selected verifier is visible before Start.

Verifier execution is part of the user's explicit autonomous-run authorization and runs with:
- fixed argv;
- worktree cwd;
- timeout;
- output cap;
- cancellation support.

---

## 5. Loop state machine

```text
PREPARING
   ↓
RUNNING iteration N
   ↓
VERIFYING
   ├─ PASS → DONE
   ├─ FAIL → RUNNING iteration N+1
   ├─ max iterations → BUDGET_EXHAUSTED
   ├─ user cancel → CANCELLED
   └─ runtime error → FAILED
```

If AECP restarts and finds a persisted run that was PREPARING/RUNNING/VERIFYING without a live controller, it is surfaced as `INTERRUPTED`.

---

## 6. Iteration contract

Each Worker iteration receives:
- Goal;
- Definition of Done;
- iteration number / budget;
- previous verification output;
- current Git diff summary;
- hard safety instructions.

The prompt explicitly states that only AECP verification can establish completion.

The Worker does not receive permission to:
- commit;
- push;
- publish;
- change credentials;
- install system software;
- modify files outside the worktree.

---

## 7. Evidence

Each run persists:

```text
autonomy/runs/<run-id>/
  run.json
  worktree/
  verified.patch   # only after PASS
```

`run.json` contains:
- source root;
- base HEAD;
- worker/version;
- Goal/Done;
- verifier;
- iteration history;
- Worker output tail;
- verification output;
- diff summaries;
- terminal state;
- patch metadata.

Output is capped to prevent unbounded local evidence growth.

---

## 8. Verified patch

After verifier PASS:

1. AECP records intent-to-add for untracked files in the isolated worktree;
2. generates `git diff --binary HEAD`;
3. enforces an 8 MiB patch cap;
4. saves `verified.patch`;
5. marks the run DONE.

No change is applied to the active Workspace at this point.

---

## 9. Apply gate

The **Apply verified changes** button is intentionally explicit.

Before apply, AECP verifies again:

1. active Workspace still matches the run source;
2. source repository is clean;
3. current HEAD still equals the run's base HEAD;
4. patch size is within policy;
5. `git apply --check` passes.

Only then:

```text
git apply verified.patch
```

Changes remain **uncommitted** in the real Workspace so the user can review them.

No automatic commit/push occurs in v0.3.

---

## 10. Process control

Every Worker and verifier process has:
- timeout;
- bounded stdout/stderr capture;
- cancel signal;
- best-effort process-tree termination.

On Windows, cancellation uses a fixed internal `taskkill /T /F` path for the known child PID; chat/model text cannot supply process IDs or arbitrary commands.

---

## 11. Beginner UX

The normal flow is:

```text
Goal
Done
↓
AECP auto-recommends Worker + Verifier
↓
Start autonomous run
↓
watch state / iteration
↓
PASS
↓
Open worktree (optional)
↓
Apply verified changes
```

A beginner should not need to understand:
- Git worktree internals;
- CLI flags;
- OpenCode permission schema;
- Codex sandbox flags.

Those details remain visible in Engineering/Blueprint documentation.

---

## 12. Current limits

v0.3 still does not:
- operate on a dirty Workspace;
- operate on a non-Git Workspace;
- auto-commit;
- auto-push;
- auto-publish;
- permit arbitrary shell to OpenCode;
- enable Claude Code/Gemini as autonomous writers;
- guarantee a verifier exists for every project type;
- prove safety against malicious project test scripts.

Project verification commands themselves are code and must still be treated as trusted project operations.

---

## 13. Acceptance criteria

v0.3 PASS requires:

1. spec validation rejects unsupported Worker/Verifier;
2. OpenCode invocation includes deny-first external-directory and shell policy;
3. Codex invocation uses `workspace-write` sandbox and network-disabled config;
4. dirty source repository blocks Start;
5. worktree is isolated from source;
6. Worker changes appear only in worktree during the run;
7. failed verification can trigger another bounded iteration;
8. max iteration stops the loop;
9. cancellation stops the active process;
10. PASS generates a bounded binary patch;
11. source HEAD/status are revalidated before Apply;
12. Apply is explicit;
13. applied changes remain uncommitted;
14. CI unit/integration tests prove isolation + explicit apply behavior;
15. x64, ARM64 and Auto-Detect installers still package successfully.
