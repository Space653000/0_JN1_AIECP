# 19 — v0.3 Triple Audit: Bounded Autonomous Execution

> **HISTORICAL AUDIT NOTICE (2026-09-23):** This file preserves the release audit for its named version. Current implementation status and remaining gates are authoritative in `23_IMPLEMENTATION_STATUS.md`; exact-HEAD GitHub Actions evidence overrides historical PASS/DEFERRED wording.

Audit date: 2026-09-18

Audited implementation head: `cdffa97f1d6ca6404af57b69412d0fd03942ad25`

Primary CI evidence: GitHub Actions run `35299372645`

## Scope

v0.3 is approved only for **bounded autonomous software-engineering changes inside an isolated Git worktree**.

It does not claim general desktop autonomy, unrestricted shell access, automatic publishing, or physical-device validation of every external worker.

---

# Audit A — Goal / UX / architecture conformance

| Requirement | Evidence | Result |
|---|---|---|
| User specifies Goal + Definition of Done | Goal Loop form is reused by bounded autonomous card | PASS |
| Beginner does not need to understand worktrees | UI exposes Worker / Verifier / budget / Start / Cancel / Open / Apply | PASS |
| Worker never writes active checkout during run | engine creates detached worktree from recorded base HEAD | PASS |
| Deterministic verification belongs to AECP | fixed verifier profiles are executed by AECP after every successful worker iteration | PASS |
| Failed verification can iterate | bounded loop carries prior verifier output into next iteration | PASS |
| Iteration/timeout are externally enforced | max iterations/turns/failed attempts/no-progress/output/patch/files + per-process timeout are owned by AECP | PASS |
| High-impact merge into source is explicit | Apply verified changes is a separate user action | PASS |
| No automatic commit/push/publish | no such operation exists in v0.3 autonomous path | PASS |
| Worker/provider can evolve independently | OpenCode + Codex adapters share canonical Goal/Done/Evidence engine | PASS |
| Existing Web Safe Bridge/MCP remains intact | no replacement of v0.2 execution paths | PASS |

## Audit A result

**PASS**

---

# Audit B — Isolation / security / failure behavior

| Control | Implementation | Result |
|---|---|---|
| Source must be exact Git root | Git `rev-parse --show-toplevel` compared using canonical physical-path equality | PASS |
| Windows path representation safe | realpath + normalized case-insensitive comparison on Windows | PASS |
| Dirty source rejected | `git status --porcelain` must be empty | PASS |
| Base version pinned | base HEAD recorded before worktree creation | PASS |
| Isolated execution | detached `git worktree add` under AECP user-data run directory | PASS |
| OpenCode external directory denied | inline permission policy | PASS |
| OpenCode arbitrary shell denied | deny-first shell rules; only read-only Git status/diff exceptions | PASS |
| Codex local write bounded | workspace-write sandbox + sandbox network disabled | PASS |
| Worker cannot decide PASS | only AECP verifier result can transition run to DONE | PASS |
| Output bounded | worker/verifier output is hard-capped; overflow terminates the process/run budget rather than silently truncating to PASS | PASS |
| Patch bounded | binary patch and changed-file count are hard-capped before accepted evidence/DONE | PASS |
| Apply rejects stale source | source must still be clean and at recorded base HEAD | PASS |
| Patch compatibility checked | `git apply --check` before apply | PASS |
| Cancellation supported | AbortController + child process-tree termination | PASS |
| Interrupted crash state surfaced | stale active state becomes INTERRUPTED on reload | PASS |

### Cross-platform defects found and fixed during audit

1. **Windows Git-root false negative** — Git/Node represented the same path differently. Fixed by canonical physical-path comparison rather than string equality.
2. **Windows CRLF test false negative** — successful `git apply` may normalize line endings to CRLF. Integration assertion now compares semantic text after EOL normalization; engine behavior was already correct.
3. **Missing source node_modules link bug** — optional shared dependency link no longer creates a broken link when source `node_modules` is absent.

These defects were found by preserving Windows verification rather than skipping it.

## Audit B result

**PASS**

---

# Audit C — Executable evidence / test honesty

## Automated evidence

Run `35299372645`:

- Static checks and tests — **SUCCESS**
- Windows x64 — **SUCCESS**
- Windows ARM64 — **SUCCESS**
- Windows Auto Detect x64+ARM64 — **SUCCESS**

Unit/integration tests:
- total: **19**
- pass: **19**
- fail: **0**

The autonomy integration test uses a real temporary Git repository and real Git worktree/patch operations. The Worker and Verifier are injected test doubles so that CI can deterministically prove orchestration and isolation.

The test proves:
1. a Worker change occurs in the isolated worktree;
2. source checkout stays unchanged during the run;
3. AECP can mark the run DONE only after verifier success;
4. a verified patch is generated;
5. source changes only after the explicit apply function is invoked.

## Packaging artifacts

- `aecp-windows-x64` — ~122.0 MB archive
- `aecp-windows-arm64` — ~116.3 MB archive
- `aecp-windows-auto` — ~237.8 MB archive

## What CI does NOT prove

Repository CI does **not** prove:
- OpenCode is installed/configured on the user's physical laptop;
- the user's chosen local OpenCode model produces useful engineering edits;
- Codex CLI account/quota is available on the user's laptop;
- every real project has a safe, deterministic verifier;
- a project's own test scripts are benign;
- physical ARM64 installation/run has been smoke-tested by the user.

These remain real-machine/user-project validation gates.

## Audit C result

**PASS WITH PHYSICAL-WORKER VALIDATION DISCLOSED**

---

# Final v0.3 verdict

| Audit | Result |
|---|---|
| A — product/UX/architecture | **PASS** |
| B — isolation/security/failure controls | **PASS** |
| C — CI/build/evidence honesty | **PASS WITH PHYSICAL-WORKER VALIDATION DISCLOSED** |

## Merge decision

**APPROVED FOR v0.3.0 Preview merge/release, provided this audit-only final head also reproduces a fully green CI run.**

v0.3 must continue to be described as bounded autonomous software-engineering execution, not unrestricted computer autonomy.
