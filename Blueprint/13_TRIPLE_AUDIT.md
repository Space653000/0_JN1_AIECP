# 13 — Triple Blueprint Audit

> **HISTORICAL AUDIT NOTICE (2026-09-23):** This document records the v0.1 audit at that point in time. `DEFERRED` statements below are historical and must not be used as current implementation status. Current status is authoritative in `23_IMPLEMENTATION_STATUS.md`, with exact-HEAD Actions evidence required for PASS.


Audit date: 2026-09-18

Audited branch: `feat/initial-blueprint-and-mvp`

Evidence commit: `428240c926e317ab77777e7241535360e8ba0b58`

Primary CI evidence: GitHub Actions run `35286851787`


## Scope statement

This audit distinguishes two things deliberately:

1. **v0.1.0 Preview release scope** — the Safe-Bridge engineering workstation that is actually implemented and packaged now.
2. **Full product roadmap** — future governed write adapters, arbitrary engineering tool orchestration, desktop UI automation, official MCP write transport, external API invocation, local model workers, worktree-per-task, and remote/mobile supervision.

The roadmap is intentionally **not** misrepresented as implemented. A PASS below means the implemented v0.1.0 scope conforms to its Blueprint/acceptance contract; future phases remain explicitly `DEFERRED PER BLUEPRINT`.

---

# Audit A — Founding requirement and Blueprint coverage

## Question

Does every founding requirement either (a) exist in the current v0.1.0 implementation, or (b) have an explicit governed Blueprint/roadmap path without being falsely claimed as complete?

## Evidence reviewed

- `Blueprint/00_MASTER_BLUEPRINT.md`
- `Blueprint/01_UX_UI_SPEC.md`
- `Blueprint/02_LOCAL_AGENT_HARNESS.md`
- `Blueprint/03_PROVIDER_ROUTER.md`
- `Blueprint/05_GITHUB_MULTI_REPO.md`
- `Blueprint/06_DESKTOP_CHATGPT_INTEGRATION.md`
- `Blueprint/08_ROADMAP_ACCEPTANCE.md`
- `Blueprint/Conversation/2026-09-17_FOUNDING_CONVERSATION.md`
- `README.md`
- implementation under `electron/` and `ui/`

## Matrix

| Founding requirement | v0.1.0 evidence | Audit result |
|---|---|---|
| Product name = AI Engineering Control Plane | package/product/README/Blueprint all use AECP name | PASS |
| Completely independent new project | dedicated repository + self-contained Blueprint | PASS |
| Dedicated `Blueprint/` source of truth | 14 core Blueprint docs + conversation archive | PASS |
| Preserve project-specific founding conversation | `Blueprint/Conversation/2026-09-17_FOUNDING_CONVERSATION.md` | PASS |
| Official ChatGPT Web remains official/unmodified | `shell.openExternal('https://chatgpt.com/')`; no embedded privileged origin | PASS |
| Default does not require OpenAI API key | built-in `chatgpt-web` Safe Bridge provider | PASS |
| Explicit Web conversation → local task → verified result loop | Command Card import + Task + Evidence + Result Capsule copy | PASS |
| Left local / center control / right official ChatGPT UX | three-pane UI implementation | PASS |
| Harness/kanban/software-delivery discipline | Board/Pipeline/Trace/Evidence + versioned task state | PASS |
| Workspace Graph / relationship view | Graph projects Workspace/Repos/Providers/Tools | PASS (read-only graph in preview) |
| Multiple local repositories represented | Workspace scans root/direct-child Git repos | PASS for discovery; advanced multi-repo write orchestration DEFERRED |
| GitHub/provider extensibility | local remote display + Provider Registry architecture | PASS for architecture/metadata; live API/GitHub mutation DEFERRED |
| External API keys can be attached later | Provider Registry + encrypted `safeStorage` credential payload | PASS for secure registration; invocation DEFERRED |
| Local CPU/GPU/tool awareness | tool discovery includes Git/PowerShell/Python/Node/gh/Ollama | PASS for discovery; GPU worker routing DEFERRED |
| Beginner can obtain Windows EXE | single Auto-Detect x64+ARM64 NSIS artifact plus x64/ARM64 fallbacks successfully packaged | PASS for packaging |
| README suitable for beginner | one primary installer, install, auto-detection, first Workspace, Guided Start, Safe Bridge, Agent Switcher, private update, limitations | PASS |
| Guided long-horizon work | Goal Loop planner + Done criteria + iteration/checkpoint/stop contract | PASS for planner; automated provider loop execution DEFERRED |
| Multi-agent switching | fixed detection/launch adapters for ChatGPT Web, Codex CLI, Claude Code, Gemini CLI and Ollama | PASS |
| Conversation-driven evolution | authorized ChatGPT → GitHub → CI → Release → installed-app path documented | PASS for delivery architecture |
| Private GitHub self-update | allowlisted repo + `gh` auth + semver Release selection + SHA-256 verified installer | PASS for preview update path; rollback/signing remain stable gates |
| Future Codex-like remote supervision path | authenticated Remote Gateway specified | DEFERRED PER BLUEPRINT |
| Full desktop/local autonomous construction | security/policy/Harness adapter roadmap specified | DEFERRED PER BLUEPRINT |

## Finding A1 — Scope discipline

The earliest implementation attempt considered accepting an arbitrary shell string. This was rejected before release. `aecp.task/v1` now exposes only structured read-only `inspect-workspace` and `git-status` capabilities. Blueprint and README were corrected to match the implementation.

**Disposition:** resolved.

## Result

**PASS — v0.1.0 requirement/Blueprint coverage is internally consistent.**

Full autonomous engineering construction is **not yet complete** and is correctly represented as future governed phases rather than hidden/unfinished v0.1 behavior. Guided Start, Goal Loop planning, multi-agent launchers and the trusted private Release update path are now implemented preview capabilities.

---

# Audit B — Security and architecture conformance

## Question

Does the implementation preserve the trust boundaries and safety invariants defined by the Blueprint?

## Evidence reviewed

- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/lib/protocol.cjs`
- `electron/lib/path-safety.cjs`
- `ui/index.html`
- `tests/*.test.cjs`
- CI static/unit-test result in run `35286851787`

## Checks

| Security/architecture control | Evidence | Result |
|---|---|---|
| Renderer Node access disabled | `nodeIntegration: false` | PASS |
| Context isolation | `contextIsolation: true` | PASS |
| Renderer sandbox | `sandbox: true` | PASS |
| Narrow preload API | explicit frozen `window.aecp` IPC methods only | PASS |
| Local UI CSP | CSP in `ui/index.html` with `connect-src 'none'` | PASS |
| External navigation restricted | non-file navigation prevented; external HTTPS opened through OS browser | PASS |
| ChatGPT not loaded with privileged preload | ChatGPT opened externally | PASS |
| No ChatGPT DOM injection/scraping | no ChatGPT DOM/network/session integration exists | PASS |
| Clipboard is explicit user action | `clipboard:read` called by Import button flow; no polling/listener | PASS |
| Imported card cannot self-grant arbitrary command execution | action allowlist = `inspect-workspace`, `git-status` | PASS |
| Protocol version validation | `aecp.task/v1` required; unsupported schema/action rejected | PASS |
| Workspace path helper rejects outside paths | tests cover root/child/outside boundary | PASS |
| Provider secrets not stored plaintext | `safeStorage.encryptString` + opaque credential reference | PASS |
| No telemetry/analytics SDK | none present | PASS |
| Evidence local by default | stored under Electron userData/evidence | PASS |
| Unit/static checks | 13 tests passed; syntax checks passed | PASS |
| Trusted update origin | update repository is a fixed constant; chat/task payloads cannot override it | PASS |
| Private GitHub token boundary | authentication stays in official `gh`; AECP invokes CLI without extracting token | PASS |
| Update integrity | installer must match `SHA256SUMS.txt` before launch | PASS |
| Agent launch surface | only fixed built-in agent IDs/commands are launchable; no chat-supplied executable | PASS |

## Findings

### B1 — Preview is intentionally read-only

This is a security feature, not a missing hidden permission. Mutating adapters require future Policy Engine approval/verification work before exposure.

**Disposition:** accepted design constraint.

### B2 — Unsigned preview installers

No Authenticode certificate is configured; CI logs explicitly show signing skipped. Windows SmartScreen can warn.

**Disposition:** documented in README/Release Notes; stable 1.0 remains blocked on signing.

### B3 — Dependency deprecation warnings

The packaging dependency tree reports deprecated transitive packages (for example legacy `glob`, `rimraf`, `boolean`) from the current builder ecosystem. The app itself has only Electron/electron-builder development dependencies in this bootstrap.

**Disposition:** monitor/update dependencies before stable 1.0; does not block the preview package build.

## Result

**PASS — v0.1.0 security/architecture conforms to the Blueprint boundaries reviewed.**

---

# Audit C — New-user and release operability

## Question

Can the repository actually produce the Windows installers and documented beginner-facing artifacts rather than merely describing them?

## CI evidence

Run: `35286851787`

Commit: `428240c926e317ab77777e7241535360e8ba0b58`

Jobs:

- `Static checks and tests` — **SUCCESS**
- `Package Windows x64` — **SUCCESS**
- `Package Windows arm64` — **SUCCESS**
- `Package Windows Auto Detect (x64 + ARM64)` — **SUCCESS**

Test evidence:

- total tests: 13
- passed: 13
- failed: 0

Artifacts:

- `aecp-windows-x64` — uploaded successfully
- `aecp-windows-arm64` — uploaded successfully
- `aecp-windows-auto` — uploaded successfully (~234.9 MB)

Previous build artifact contents were independently inspected:

- `AI-Engineering-Control-Plane-Setup-x64-0.1.0.exe`
- `AI-Engineering-Control-Plane-Setup-x64-0.1.0.exe.blockmap`
- `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe`
- `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe.blockmap`

ARM64 job log independently confirms:

- electron-builder `26.16.1`
- Electron `44.4.1`
- rebuild `arch=arm64`
- packaging `platform=win32 arch=arm64`
- output `release\\win-arm64-unpacked`
- NSIS output `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe`

This proves an ARM64 Electron payload was packaged; it is not merely an ARM64 filename.

## Beginner documentation check

README contains:

1. one primary Auto-Detect installer; architecture-specific files are fallback only;
2. installation steps;
3. SmartScreen/unsigned preview explanation;
4. first Workspace selection;
5. official ChatGPT launch;
6. safe sample task;
7. Board/Pipeline/Graph/Trace/Evidence explanation;
8. Command Card example;
9. Import → Run → Copy Result → paste back flow;
10. Provider Registry explanation;
11. Agent Switcher and fixed local/CLI launch behavior;
12. private GitHub Connect / Check Update / Apply Update flow;
13. Goal Loop usage and safety boundaries;
14. explicit unsupported/roadmap list;
15. developer build instructions separated from ordinary-user instructions.

## Limitation C1 — no physical Windows-on-ARM launch test performed by this audit

GitHub's x64 Windows runner cross-packaged the ARM64 Electron payload successfully, but this audit does not have access to the user's physical ARM64 laptop and therefore cannot truthfully claim a real-device launch/UI interaction test.

**Disposition:** clearly disclosed. The user can perform the final physical-device smoke test after the Release asset is published. This limitation blocks a claim of “100% hardware-validated,” but not the repository's verified ability to generate the ARM64 package.

## Limitation C2 — stable release gates remain open

v0.1.0 is a Preview. Authenticode signing, post-update health-check/rollback, broad write adapters, full accessibility/localization validation and physical-device test coverage remain stable-release gates.

## Result

**PASS WITH DISCLOSED LIMITATIONS — release pipeline and artifacts are real and reproducible; physical ARM64 runtime validation and stable-1.0 gates remain outstanding.**

---

# Final triple-audit verdict

| Audit | Result |
|---|---|
| A — founding requirements / Blueprint coverage | **PASS for v0.1.0 scope** |
| B — security / architecture conformance | **PASS** |
| C — beginner / release operability | **PASS WITH DISCLOSED LIMITATIONS** |

## Release decision

**APPROVED FOR `v0.1.0 Preview` merge/release.**

It is **not approved to be described as a fully autonomous 1.0 implementation**. The Blueprint deliberately keeps later high-power capabilities behind explicit future acceptance gates.
