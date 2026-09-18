# AI Engineering Control Plane v0.3.0 — Preview

v0.3 turns **Local Autonomous** into a real bounded execution path.

## Recommended download

Download only:

`AI-Engineering-Control-Plane-Setup-0.3.0.exe`

It auto-selects x64 or ARM64. Architecture-specific installers remain fallbacks.

## New: Bounded Autonomous Execution

Normal flow:

```text
Goal + Definition of Done
        ↓
AECP checks clean Git-root Workspace
        ↓
isolated detached worktree
        ↓
OpenCode or Codex CLI worker
        ↓
fixed AECP verifier
        ↓
FAIL → retry within budget
PASS → verified.patch
        ↓
explicit Apply
        ↓
real Workspace receives uncommitted changes
```

### Supported autonomous workers

**OpenCode**
- default recommendation when detected
- v1/v2 permission schema handling
- worktree-local read/edit/glob/grep
- arbitrary shell denied
- external directories denied
- web fetch/search and subagents denied
- only read-only `git status` / `git diff` shell exceptions

**Codex CLI**
- `codex exec`
- `--sandbox workspace-write`
- `--ignore-user-config`
- `--ignore-rules`
- ephemeral JSON execution
- sandbox network disabled

Claude Code / Gemini CLI remain launchable agents but are not enabled as autonomous writers in this preview.

### Verification profiles
- `npm run verify`
- `npm test`
- `python -m pytest -q`
- `python -m unittest`

AECP recommends a verifier from the current repository.

### Safety gates
- source Workspace must be clean
- source Workspace must itself be the Git root
- Worker edits isolated worktree only
- max 12 iterations
- per-iteration timeout
- bounded output capture
- cancellation
- PASS required before patch generation
- patch capped at 8 MiB
- original source HEAD + clean state rechecked before Apply
- `git apply --check` before mutation
- no auto commit/push/publish

## Existing v0.2 foundations retained
- official ChatGPT Web Safe Bridge
- three execution modes
- Local MCP read-only server
- Agent Switcher
- private GitHub self-update
- x64/ARM64 Auto-Detect installer

## Verification

CI now additionally tests:
- autonomy spec validation
- OpenCode deny-first invocation policy
- Codex workspace-write invocation
- iteration prompt contract
- real temporary Git repo → isolated worktree write → original remains unchanged → explicit verified patch apply

No telemetry is included.
