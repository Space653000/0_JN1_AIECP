# 01 — UX / UI Specification

## 1. UX principles

- Familiar to a ChatGPT user without pretending to be ChatGPT.
- AECP has its own name/icon. OpenAI/ChatGPT branding is used only to identify the official external provider surface and must follow current brand rules.
- Beginner-first: important actions are obvious; dangerous details are hidden until needed.
- Engineering-grade observability: every action can be traced and inspected.
- Calm status language: Connected, Ready, Running, Waiting, Verified, Failed — no ambiguous animations.
- Keyboard friendly and screen-reader compatible.

## 2. Default shell

```text
┌────────────────────────────────────────────────────────────────────────┐
│ AECP  [Workspace ▼]  [Health ●] [Beginner ▼]          [Settings]      │
├────────────────────┬────────────────────────────┬──────────────────────┤
│ LOCAL COMPUTER     │ CONTROL PLANE              │ OFFICIAL CHATGPT     │
│                    │                            │                      │
│ Workspace          │ Board | Pipeline | Graph   │ Open ChatGPT         │
│ Folders            │ Trace | Evidence           │ Browser Dock status  │
│ Repositories       │                            │ Safe handoff          │
│ Tools / Compute    │ Current task / approvals   │                      │
└────────────────────┴────────────────────────────┴──────────────────────┘
```

The right pane can become a compact status/launcher when ChatGPT is open in an external browser. AECP must remain fully usable in that state.

## 3. First-run onboarding (maximum five steps)

1. **Welcome** — explain that AECP is local software and ChatGPT remains official/separate.
2. **Choose Workspace** — native folder picker; do not require path typing.
3. **Detect tools** — Git, PowerShell, Python, Node, GitHub CLI, optional local-model runtime. Missing optional tools are warnings.
4. **Connect ChatGPT workflow** — show Safe Bridge: Open ChatGPT → copy Command Card → Import from Clipboard → run → Copy Result.
5. **Safety summary** — green/yellow/red action categories with one default policy choice: Recommended.

Finish opens the Workspace dashboard with one sample read-only task.

## 4. Beginner vs Engineering mode

### Beginner

Shows:
- Workspace
- Open ChatGPT
- Import Task
- Tasks
- Repositories
- Run/Cancel
- Result
- simple risk confirmation

Hides raw provider routing, adapter health, JSON protocol and verbose traces behind `Details`.

### Engineering

Adds:
- provider registry
- adapter capability matrix
- policy editor
- Graph view
- raw Command/Result Capsule
- full Execution Trace
- environment/tool versions
- task locks/worktrees

Changing mode never changes permissions by itself.

## 5. Control Plane views

All views project the same canonical state.

### Board

Columns:
`INBOX`, `READY`, `RUNNING`, `WAITING`, `VERIFYING`, `DONE`, `FAILED`.

Task cards show title, workspace, executor, risk, repo count, current step, test state and elapsed time.

### Pipeline

A single task is displayed as stages:

`UNDERSTAND → PREPARE → EXECUTE → VERIFY → PACKAGE_RESULT`

Optional engineering stage for code work:

`LOCK → WORKTREE → MODIFY → BUILD → TEST → REVIEW → COMMIT_READY`.

Every stage exposes timeout, retry/failure behavior and evidence.

### Graph

Nodes:
- Conversation/link
- Workspace
- Folder
- Repository
- GitHub remote
- Task
- Tool
- Provider
- Policy
- Executor

Edges are permissions/capabilities. Editing an edge changes the real binding after confirmation.

### Trace

Chronological append-only event stream:

```text
22:31:04 task imported
22:31:05 policy checked: GREEN
22:31:06 workspace lock acquired
22:31:07 git status: clean
22:31:15 command started
22:31:49 command exited: 0
22:31:50 verification: PASS
22:31:51 result capsule ready
```

### Evidence

Cards for command output, test summary, changed files, Git state, screenshots (future), hashes and generated reports. Evidence is local by default.

## 6. Local Computer pane

Shows:
- Workspace folder with `Open` button
- detected repositories with branch + dirty/clean state
- local tools and versions
- compute providers/status
- quick actions: Open Explorer, Open Terminal, Refresh, Add Repo

No hidden background shell execution is allowed. Refresh/detection operations are read-only.

## 7. Official ChatGPT pane

Default behavior:
- `Open official ChatGPT` button opens `https://chatgpt.com` externally.
- Show `Safe Bridge` steps.
- `Import from Clipboard` explicitly reads clipboard after the user presses it.
- `Copy Result` explicitly writes the selected Result Capsule.

Experimental future behavior:
- Browser Dock: align AECP and an external browser side-by-side without injecting into it.
- Embedded surface may only be explored if it remains an unmodified official origin with no privileged preload, interception, scraping or unsupported authentication behavior. It is never the sole supported path.

## 8. ChatGPT-like visual language without impersonation

Adopt interaction qualities, not proprietary identity:
- neutral surfaces
- simple monochrome tool icons
- rounded controls
- clear composer-style input for local task notes
- compact tool/status chips
- light/dark/system themes

AECP's own logo/name must remain more prominent than provider branding.

## 9. Risk confirmation UX

- **Green** — read-only/local inspection. Runs without confirmation once the user initiated the task.
- **Yellow** — writes inside workspace, package install, commit, GUI manipulation. Show concise action preview and require approval unless the workspace policy explicitly pre-authorizes it.
- **Red** — delete, push/publish, credential use, system/admin changes, actions outside workspace, billing. Always explicit approval; some actions may be denied entirely.

Confirmation dialog answers: **what**, **where**, **why**, **reversibility**, **evidence to be produced**.

## 10. Accessibility and quality

- 4.5:1 text contrast target
- visible keyboard focus
- semantic buttons/labels
- no color-only status
- reduced-motion friendly
- 125–200% Windows scaling support
- useful at 1366×768 and optimized for 1920×1080+
- dark/light/system theme
- Traditional Chinese and English architecture-ready; bootstrap UI begins bilingual-friendly with plain English labels and concise helper text.
