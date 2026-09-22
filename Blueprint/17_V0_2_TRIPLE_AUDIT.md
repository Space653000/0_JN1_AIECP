# 17 — v0.2 Triple Audit: Constraint Resolution

Audit date: 2026-09-18

Audited branch: `feat/v0.2-distribution-and-execution-modes`

Implementation evidence commit: `df9552ff6391b4ce75902425e3ba6fc76f5a3de4`

Primary CI evidence: GitHub Actions run `35290049186`

## Scope discipline

This audit tests whether v0.2 materially improves the two v0.1 limitations without falsely claiming external milestones that have not occurred.

The audited v0.2 scope is:

1. preserve Web Safe Bridge;
2. establish a Local Autonomous execution-mode path and worker readiness;
3. implement the local, authenticated, read-only MCP foundation for future official ChatGPT integration;
4. define a Microsoft Store Private Audience path for trusted distribution;
5. continue producing x64, ARM64 and Auto-Detect Windows installers.

The following are explicitly **not** claimed complete:
- Microsoft Partner Center enrollment/reservation/certification;
- Store-installed package on a physical clean machine;
- real Secure MCP Tunnel provisioning against the user's ChatGPT workspace;
- MCP write/modify tools;
- autonomous arbitrary file mutation;
- unrestricted shell execution;
- stable 1.0 signing/rollback.

---

# Audit A — Product goal / alternative-path coverage

## Question

Do the v0.2 changes preserve the user's original goal while providing credible alternatives to the two v0.1 limitations?

| Requirement / constraint | v0.2 evidence | Result |
|---|---|---|
| Keep official ChatGPT Web untouched | Web Safe Bridge remains; no DOM injection/scraping added | PASS |
| Avoid forcing OpenAI model API billing | Web Safe Bridge and Local worker paths remain available without OpenAI model API calls | PASS |
| Reduce manual handoff where possible | Local Autonomous mode is represented and local/CLI worker readiness is detected | PASS FOR ROUTING/BOUNDED EXECUTION FOUNDATION |
| Keep exact official ChatGPT→local path possible | Local MCP runtime + Official Full MCP architecture documented | PASS FOR LOCAL FOUNDATION; REAL TUNNEL DEFERRED |
| Do not bind product to one provider | ChatGPT Web, Codex CLI, Claude Code, Gemini CLI, OpenCode, Ollama adapters detected/launched | PASS |
| Preserve canonical task/evidence model | execution modes share Goal / Done / Workspace / Evidence architecture | PASS |
| Resolve SmartScreen as permanent product limitation | Store Private Audience software lane builds/validates x64+ARM64 AppX with owner-identity workflow | PASS FOR SOFTWARE LANE; STORE CERTIFICATION EXTERNAL |
| Keep private GitHub Preview distribution | existing trusted private Release updater remains | PASS |

### Finding A1 — “Ready” language

Official Full MCP must not be considered end-to-end ready merely because the Local MCP server is running. UI distinguishes local MCP availability from configured remote MCP/provider readiness.

**Disposition:** PASS.

### Finding A2 — Local Autonomous is not yet an autonomous write loop

Worker detection/launch and execution-mode recommendation exist, but the v0.2 preview does not expose unrestricted write automation.

**Disposition:** correctly disclosed; PASS for scope discipline.

## Audit A result

**PASS — v0.2 provides real local foundations and well-defined alternative paths without claiming external Store/Tunnel completion.**

---

# Audit B — Security / MCP / worker boundary

## Question

Did solving the automation problem weaken the v0.1 trust boundaries?

| Security control | Evidence | Result |
|---|---|---|
| Local MCP network scope | HTTP server binds `127.0.0.1` only | PASS |
| Host/Origin validation | MCP Node localhost validators applied before handler | PASS |
| Authentication | MCP endpoint requires bearer token | PASS |
| Token strength | 32 random bytes, base64url encoded | PASS |
| Token at rest | encrypted using Electron `safeStorage` | PASS |
| Secret exposure | copied only by explicit user action; not returned in public status | PASS |
| Workspace boundary | MCP server starts only with active Workspace | PASS |
| File path boundary | absolute paths/traversal outside Workspace rejected | PASS |
| Read size boundary | text read capped at 256 KiB | PASS |
| MCP capability surface | status / inspect / git status / text read only | PASS |
| No raw MCP shell | no raw shell MCP tool exists | PASS |
| No MCP write/delete/push | none exposed in audited version | PASS |
| Worker executable selection | fixed built-in agent specs; chat payload cannot choose arbitrary executable | PASS |
| OpenCode addition | factual version detection / fixed launcher only | PASS |
| Renderer privilege baseline | v0.1 context isolation/sandbox/narrow preload retained | PASS |
| ChatGPT boundary | no browser cookie/session/DOM access added | PASS |

## Runtime test evidence

CI test `tests/mcp-server.test.cjs`:
- starts a real MCP HTTP server on loopback;
- verifies the returned endpoint uses `127.0.0.1`;
- GET `/healthz` returns 200 and read-only status;
- unauthenticated POST `/mcp` returns HTTP 401;
- stops the server and removes its temporary Workspace.

Static/unit result in run `35290049186`:
- tests: **14**
- pass: **14**
- fail: **0**

### Finding B1 — Health endpoint is unauthenticated

`/healthz` exposes only `{ ok: true, mode: "read-only" }`, no Workspace path/token/data.

**Disposition:** acceptable minimal local health surface.

### Finding B2 — Copy connection places bearer on clipboard

This is an intentional explicit operation, but clipboard content is a temporary secret surface.

**Disposition:** documented warning required; clipboard bearer copy remains an explicit local action; direct supported tunnel provisioning remains an external product/deployment path. The bearer is never returned by public status or background-copied.

### Finding B3 — MCP is read-only by design

Write tools are intentionally absent until the Policy Engine has scoped write capabilities, approvals and deterministic verification.

**Disposition:** security requirement, not a hidden missing feature.

## Audit B result

**PASS — the new MCP/agent foundations preserve the local trust model and do not open unrestricted execution.**

---

# Audit C — Build / packaging / newcomer operability

## Question

Can the v0.2 code, including MCP runtime dependencies, actually pass tests and package on all required Windows targets?

## CI evidence

Run: `35290049186`

Jobs:
- Static checks and tests — **SUCCESS**
- Package Windows x64 — **SUCCESS**
- Package Windows arm64 — **SUCCESS**
- Package Windows Auto Detect (x64 + ARM64) — **SUCCESS**

Artifacts:
- `aecp-windows-x64` — ~122.0 MB archive — uploaded
- `aecp-windows-arm64` — ~116.3 MB archive — uploaded
- `aecp-windows-auto` — ~237.8 MB archive — uploaded

This proves:
- MCP runtime dependencies install on CI;
- MCP tests execute on Node 24;
- Windows packaging does not fail due to the new production dependencies;
- the combined Auto-Detect route remains buildable;
- ARM64 fallback remains buildable.

## Documentation check

README now explains:
- one primary Auto-Detect installer;
- the two v0.1 constraints and their v0.2 resolution paths;
- three execution modes;
- Local MCP Start / Stop / Copy connection;
- bearer secret warning;
- OpenCode and other worker choices;
- what remains deferred;
- the difference between local MCP readiness and actual ChatGPT Full MCP availability.

## External prerequisites intentionally not testable in repository CI

- Microsoft Partner Center identity and Store certification;
- physical Windows-on-ARM installation;
- real ChatGPT Business/Enterprise/Edu workspace MCP connection;
- Secure MCP Tunnel account provisioning.

These cannot be truthfully marked PASS from repository CI alone.

## Audit C result

**PASS WITH EXTERNAL PREREQUISITES DISCLOSED — v0.2 code/tests/packages are reproducible; Store and live ChatGPT tunnel remain owner/account/device validation gates.**

---

# Final v0.2 triple-audit verdict

| Audit | Result |
|---|---|
| A — product goal / constraint-resolution coverage | **PASS** |
| B — security / MCP / worker boundary | **PASS** |
| C — CI / Windows packaging / documentation | **PASS WITH DISCLOSED EXTERNAL PREREQUISITES** |

## Merge decision

**APPROVED FOR v0.2.0 Preview merge/release, subject to the audit-only final-head CI also remaining green.**

This approval does not convert roadmap items into implemented claims. Store certification, live Secure MCP Tunnel and production signing remain separate external acceptance gates. Write-capable Local Autonomous execution is now implemented in v0.3 behind isolated-worktree, deterministic-verifier and explicit-apply controls.
