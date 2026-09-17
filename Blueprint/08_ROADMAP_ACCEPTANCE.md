# 08 — Roadmap and Acceptance Gates

## P0 — Product foundation

Deliverables:
- complete Blueprint source of truth
- secure Electron shell
- local persistence
- first-run wizard
- Workspace folder selection
- tool detection

Acceptance:
- no privileged renderer access
- no remote ChatGPT content loaded with privileged preload
- app starts with no external API key

## P1 — Safe Bridge MVP

Deliverables:
- Open official ChatGPT
- explicit clipboard import
- Command Card validation
- task creation/state
- risk preview
- explicit run/cancel
- Result Capsule copy

Acceptance:
- clipboard is never polled in background
- invalid cards produce actionable validation errors
- no ChatGPT scraping/injection/network interception

## P2 — Local engineering execution

Deliverables:
- PowerShell execution inside bound Workspace
- timeout/cancel
- stdout/stderr capture
- Git status/branch/remote detection
- trace/evidence storage
- deterministic verifier

Acceptance:
- cwd outside Workspace rejected
- dangerous/high-impact actions blocked or approval-gated
- write task cannot finish without verification/manual gate

## P3 — Multi-repository control plane

Deliverables:
- attach/detect multiple local repos
- per-repo health/branch/dirty state
- task resource bindings
- repo write locks
- worktree-per-task implementation

Acceptance:
- conflicting writes are prevented
- dirty main checkout is never silently overwritten

## P4 — Provider/Tool extensibility

Deliverables:
- Provider Registry
- encrypted API credential references
- Local Provider adapter
- MCP adapter slot
- capability matrix

Acceptance:
- Safe Bridge remains usable with every optional provider disabled
- switching provider never changes local security policy implicitly

## P5 — Desktop/engineering adapters

Deliverables:
- browser window dock adapter
- Windows UI Automation adapter
- Python worker
- optional OCR/STT/indexing/local-model services

Acceptance:
- desktop adapter is capability-scoped
- ChatGPT DOM remains untouched

## P6 — Remote supervision

Deliverables:
- authenticated Remote Gateway or supported official integration
- device pairing/revocation
- encrypted task transport
- replay protection
- remote task/result status

Acceptance:
- no public inbound port by default
- remote cannot exceed local Workspace policy
- lost device/session can be revoked

## P7 — Stable 1.0

Required:
- signed x64 and ARM64 installers
- backup/migration strategy
- upgrade/uninstall tests
- accessibility pass
- localization framework
- dependency/license/security audit
- crash recovery tests
- complete user documentation

## MVP definition used for first executable

The first executable is **not** claimed to be P7. It is considered a usable preview only if P0 + P1 + the safe subset of P2 are working and independently audited against this Blueprint.
