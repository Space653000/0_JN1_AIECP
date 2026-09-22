# 14 — Guided UX and Goal Loop Blueprint

## 1. Product principle

AECP must feel like a product, not a collection of engineering subsystems.

A beginner should not need to understand MCP, Harness, Provider Router, Git plumbing, architecture names, or task schemas before using the product.

The default UX asks only three questions:

1. **What do you want to accomplish?**
2. **Which local Workspace is AECP allowed to use?**
3. **What measurable evidence means Done?**

Everything that can be safely detected should be detected automatically. Everything that changes data access, permissions, or blast radius must remain explicit.

---

## 2. Progressive disclosure

### Beginner mode

Default for first launch.

Shows:
- Guided Start
- Workspace health
- detected environment health
- official ChatGPT entry point
- safe sample task
- Goal Loop
- Task Board
- Pipeline
- Evidence

Hides or de-emphasizes:
- raw trace events
- low-level adapter names
- MCP transport details
- credential internals
- provider protocol diagnostics
- shell details

### Engineering mode

Adds:
- raw Trace
- exact tool versions
- adapter/provider diagnostics
- paths and execution metadata
- policy/debug information
- terminal launch

The underlying state is identical. Modes only change presentation and optional controls.

---

## 3. First-run UX

### Step 0 — Installer

Ordinary users download one primary installer:

`AI-Engineering-Control-Plane-Setup-<version>.exe`

The installer contains x64 and ARM64 payloads and selects the correct Windows architecture automatically.

Architecture-specific installers remain fallback artifacts only.

### Step 1 — Automatic environment scan

At launch AECP automatically identifies:
- runtime architecture
- Git
- Windows PowerShell / PowerShell 7
- Python
- Node.js
- GitHub CLI
- Ollama
- previously saved Workspace

Missing optional tools appear as unavailable rather than blocking the app.

### Step 2 — One explicit authorization choice

If no Workspace exists, AECP asks for one local folder.

This remains explicit by design. AECP must not scan the entire disk to guess which personal folders, repositories, or documents are intended for AI access.

### Step 3 — Automatic Workspace scan

Inside the approved boundary AECP automatically identifies:
- root/direct-child Git repositories
- branches
- dirty/clean state
- available local tools

### Step 4 — Guided Start

The first central screen shows system readiness and three obvious paths:

1. Open official ChatGPT
2. Run a safe local check
3. Start a Goal Loop

No architecture knowledge is required.

---

## 4. Guided Start model

Guided Start is the default dashboard.

It should answer four questions immediately:

- **Where am I working?** — Workspace
- **Is my machine ready?** — environment health
- **Is my AI surface ready?** — ChatGPT/provider state
- **What should I do next?** — one recommended action

The app should prefer a single primary action over showing every possible control at once.

The current Guided Start computes `recommendedNextAction` from runtime state, for example:

```text
NO_WORKSPACE      -> CHOOSE_WORKSPACE
WORKSPACE_READY   -> OPEN_CHATGPT
NO_TASKS          -> CREATE_SAFE_SAMPLE_OR_GOAL
TASK_READY        -> RUN_TASK
TASK_DONE         -> REVIEW_EVIDENCE
LOOP_WAITING      -> RETURN_RESULT_TO_SUPERVISOR
APPROVAL_NEEDED   -> REVIEW_APPROVAL
```

---

## 5. Goal Loop

### 5.1 Purpose

Goal Loop is AECP's provider-neutral long-horizon work contract.

It absorbs useful patterns from modern agentic coding/research systems without binding AECP to Claude Code, Codex, ChatGPT API, or a specific local model.

The loop is:

```text
RESEARCH
  ↓
PLAN
  ↓
ACT
  ↓
VERIFY
  ↓
REFLECT
  ├─ DONE
  ├─ BLOCKED
  ├─ NEEDS_APPROVAL
  └─ NEXT_ITERATION -> RESEARCH
```

### 5.2 Required fields

Every Goal Loop must have:

- `goal`
- `definitionOfDone`
- `maxIterations`
- `checkpointEvery`
- `workspaceId`
- `providerPolicy`
- `permissionPolicy`
- `verificationPolicy`
- `stopConditions`

### 5.3 Definition of Done

A model may not mark a Goal Loop complete because it believes the work looks correct.

Done requires evidence tied to measurable acceptance criteria, for example:
- tests pass
- installer builds
- file exists
- expected output equals target
- screenshot/UI state matches acceptance requirement
- benchmark threshold reached
- Git state is clean
- review gate passes

### 5.4 Budget

A loop must be bounded.

Supported budgets should include:
- maximum iterations
- optional wall-clock budget
- optional provider-cost budget for API providers
- optional local compute budget
- optional maximum failed attempts

### 5.5 Checkpoints

At each checkpoint the loop generates a compact status capsule:

- goal
- current iteration
- completed evidence
- unresolved uncertainty
- current risks
- changes since last checkpoint
- recommendation: continue / change direction / ask user / stop

### 5.6 Stop conditions

The loop stops when any of these becomes true:

- Done is verified
- maximum iterations reached
- repeated attempts produce no measurable progress
- required permission is unavailable
- a high-risk action requires approval
- provider becomes unavailable
- verification cannot establish correctness
- user pauses/cancels

Infinite loops are a product bug, not a feature.

---

## 6. Web Safe Bridge Loop

ChatGPT Web remains an official independent browser surface.

AECP does not scrape or control the ChatGPT DOM.

Therefore the v0.1 Web loop is intentionally explicit:

```text
Goal Loop Contract
      ↓ copy
Official ChatGPT Web
      ↓ Command Card
AECP Local Harness
      ↓ Evidence / Result Capsule
Official ChatGPT Web
      ↓ next decision
repeat until stop condition
```

The Loop Planner creates the supervisor prompt and preserves the loop contract locally.

As official MCP or other supported integration paths become available, the same Goal Loop data model can automate more of this cycle without changing the user's project model.

---

## 7. Provider-neutral execution

The Goal Loop never hard-codes a model vendor.

Provider roles:

- `supervisor` — reasoning, decomposition, direction
- `worker` — bounded implementation/research
- `reviewer` — independent verification/review
- `vision` — optional visual inspection

Supported provider-neutral configurations include:

```text
Supervisor = ChatGPT Web
Worker     = Local Model
Reviewer   = ChatGPT Web
```

```text
Supervisor = OpenAI API
Worker     = Local Model
Reviewer   = Anthropic API
```

```text
Supervisor = Local Model
Worker     = Local Model
Reviewer   = External API
```

Provider failure must not corrupt Workspace state. The Harness owns task state, evidence and recovery.

---

## 8. Loop presets

The Goal Loop UI provides task-shaped presets so users do not have to design loops manually. Presets populate editable Goal/Done/budget defaults; they never bypass policy or approval:

### Research Loop
- gather evidence
- compare alternatives
- identify uncertainty
- synthesize findings
- stop when decision criteria are satisfied

### Build Loop
- inspect
- plan
- edit
- build
- test
- review
- repeat until acceptance criteria pass

### Debug Loop
- reproduce
- form hypothesis
- instrument
- change one variable
- rerun
- preserve evidence

### Review Loop
- inspect diff
- run tests/static checks
- review architecture/security/accessibility
- request fixes or approve

### Optimization Loop
- establish baseline
- propose change
- benchmark
- retain only measurable improvement
- repeat to target or budget

### Release Loop
- verify version
- run test matrix
- package
- hash/sign
- publish
- verify downloadable artifacts

---

## 9. Approval model

Goal Loop must integrate with the existing risk policy.

### Green
May proceed automatically when supported:
- read
- inspect
- search
- status
- tests that do not mutate external systems

### Yellow
Requires configured policy or checkpoint approval:
- project file writes
- package installation
- Git commit
- desktop UI changes

### Red
Always requires explicit approval unless an explicitly configured, separately audited enterprise policy authorizes it:
- delete outside Workspace
- Git push / force push
- credentials/account changes
- administrator/system changes
- public network exposure
- financial or irreversible external actions

The model cannot grant itself more permission.

---

## 10. Remote supervision direction

The implemented Remote Gateway provides bounded read-only/approval-only collaboration without exposing unrestricted local execution. It remains loopback-first; non-loopback requires explicit enablement + TLS, and remote task submission is intentionally disabled.

Remote clients should see only:
- active loops/tasks
- progress
- approvals
- screenshots when explicitly captured
- terminal/task summaries
- diffs
- tests
- evidence

The local machine remains the authority for:
- files
- credentials
- permissions
- providers
- execution

A secure relay architecture is preferred over opening inbound ports.

---

## 11. Recovery and trust UX

Every long-running loop should support:

- Pause
- Resume
- Cancel
- Retry current iteration
- Roll back a governed write stage when an adapter supports it
- Open Evidence
- Open Diff
- Change provider for the next iteration
- Reduce/increase budget
- Require approval at next checkpoint

If AECP crashes, loop/task state must be recoverable from local state and evidence rather than inferred from chat history.

---

## 12. Acceptance criteria

Guided UX is acceptable when a new user can:

1. download one installer without choosing CPU architecture
2. install without developer dependencies
3. launch and see detected environment state
4. choose only one Workspace authorization boundary
5. open official ChatGPT
6. run a safe task
7. inspect Evidence
8. configure a Goal + Done criteria
9. create a bounded Goal Loop prompt
10. understand exactly what is automatic vs what still requires approval

Goal Loop becomes fully autonomous only when the selected provider + adapter + policy combination can execute every required step with deterministic verification and bounded permissions.
