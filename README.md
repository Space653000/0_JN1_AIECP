# AI Engineering Control Plane

**AI Engineering Control Plane (AECP)** is a Windows-first local control plane that lets you keep using **official ChatGPT Web** as your conversational AI while AECP manages the local engineering side: Workspace boundaries, repositories, task state, local tools, evidence, and future provider adapters.

> **Current release: v0.1.0 Preview.** The default path uses ChatGPT Web and does **not** require an OpenAI API key. The preview intentionally exposes read-only local task capabilities first; it does not yet allow arbitrary AI-generated shell commands or autonomous file modification.

## The idea in one picture

```text
┌─────────────────────┬────────────────────────┬─────────────────────────┐
│ LOCAL COMPUTER      │ AECP CONTROL PLANE     │ OFFICIAL CHATGPT WEB    │
│ Workspace / Git     │ Board / Pipeline       │ Your normal browser     │
│ Tools / Terminal    │ Graph / Trace/Evidence │ Your normal account     │
└──────────┬──────────┴───────────┬────────────┴────────────┬────────────┘
           │                      │                         │
           └──────────────────────▼─────────────────────────┘
                    LOCAL AGENT HARNESS
              governed capabilities + verification
```

AECP does **not** replace ChatGPT, scrape ChatGPT, inject JavaScript into ChatGPT, copy your ChatGPT cookies, call undocumented ChatGPT APIs, or attempt to bypass service limits. The browser remains the official OpenAI surface.

---

# New here? Follow only these steps first

You do **not** need Git, Node.js, PowerShell knowledge, an OpenAI API key, or programming experience just to try AECP.

## 10-minute first-use path

1. Open this repository's **Releases** page.
2. Download **one** installer that matches your PC:
   - Windows on ARM / Snapdragon / ARM64 → `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe`
   - Intel / AMD x64 → `AI-Engineering-Control-Plane-Setup-x64-0.1.0.exe`
3. Double-click the installer and use the default per-user installation.
4. Open **AI Engineering Control Plane** from the Desktop or Start menu.
5. Click **Choose my first Workspace** and select a normal project folder on your PC.
6. Click **Open official ChatGPT**. Your normal browser opens `chatgpt.com`.
7. Return to AECP and click **Create sample task**.
8. Select the task and click **Run locally**.
9. Open **Evidence** and confirm that AECP produced a verified local result.
10. Click **Copy Result Capsule** and paste it into ChatGPT if you want ChatGPT to continue from the verified result.

If all ten steps work, your basic AECP installation is healthy.

### If Windows asks which installer architecture you need

Open:

**Windows Settings → System → About → System type**

Then use:

| System type | Installer |
|---|---|
| ARM64-based PC | `...Setup-arm64-0.1.0.exe` |
| 64-bit operating system, x64-based processor | `...Setup-x64-0.1.0.exe` |

### If SmartScreen appears

v0.1.0 Preview is currently unsigned, so Windows may show a SmartScreen warning even when the file was built by this repository's GitHub Actions workflow.

Do **not** disable Windows Security globally.

Use this checklist instead:

1. Confirm the file came from this repository's official **Release**.
2. Confirm the filename matches the expected ARM64 or x64 installer.
3. If you want an additional check, compare the installer's SHA-256 against `SHA256SUMS.txt` in the same Release.

---

# Complete feature map

The table below separates **what v0.1.0 actually does now** from capabilities that are deliberately reserved for later governed adapters.

| Area | v0.1.0 Preview status | What it means |
|---|---|---|
| Official ChatGPT Web companion | ✅ Available | Opens normal `chatgpt.com` in your normal browser; AECP does not own the login session |
| Windows Workspace selection | ✅ Available | Native folder picker and local Workspace boundary |
| Git repository discovery | ✅ Available | Detects Workspace-root and direct-child repositories |
| Git status / branch inspection | ✅ Available | Read-only Git state and evidence |
| Local tool discovery | ✅ Available | Detects Git, PowerShell, Python, Node.js, GitHub CLI and Ollama when installed |
| Task Board | ✅ Available | One canonical task model grouped by state |
| Pipeline view | ✅ Available | Understand → Prepare → Execute → Verify → Package Result |
| Workspace Graph | ✅ Available | Visual relationship among Workspace, repositories, providers and tools |
| Execution Trace | ✅ Available | Local event history for each task |
| Evidence view | ✅ Available | Verifiable local result/evidence instead of only AI claims |
| `aecp.task/v1` Command Card | ✅ Available | Structured task handoff from ChatGPT to AECP |
| `aecp.result/v1` Result Capsule | ✅ Available | Compact verified handoff back to ChatGPT |
| Clipboard Safe Bridge | ✅ Available | Clipboard is read only when you explicitly click **Import from Clipboard** |
| Provider Registry | ✅ Foundation available | Stores provider metadata for future API/local/MCP adapters |
| Protected API-key storage | ✅ Available | Optional future provider secrets are protected with OS-backed Electron `safeStorage` |
| Dark / Light theme | ✅ Available | User-selectable appearance |
| Beginner / Engineering mode | ✅ Available | Beginner mode hides lower-level engineering detail |
| Windows x64 installer | ✅ Built by CI | NSIS installer produced by GitHub Actions |
| Windows ARM64 installer | ✅ Built by CI | Native Electron ARM64 payload produced by GitHub Actions |
| Arbitrary AI shell execution | ❌ Intentionally disabled | Not accepted from copied AI text in v0.1.0 |
| Autonomous file modification | ❌ Not yet enabled | Requires a governed write adapter and stronger verification |
| Autonomous Git commit/push | ❌ Not yet enabled | Requires explicit policy, approval and evidence gates |
| Arbitrary Windows GUI control | ❌ Not yet enabled | Planned behind a dedicated desktop-control adapter |
| Automatic ChatGPT DOM automation | ❌ Not a product goal | AECP does not scrape or inject into ChatGPT Web |
| External API model execution | ❌ Registry only in v0.1.0 | Provider architecture exists; invocation adapter is later work |
| Public Remote MCP exposure | ❌ Not enabled | No automatic public exposure of local MCP endpoints |
| Mobile remote local execution | ❌ Not yet enabled | Future roadmap capability, not part of v0.1.0 |

---

# For beginners: download and use the EXE

## 1. Choose the correct installer

Open the repository's **Releases** page and download one file:

| Your Windows PC | Download |
|---|---|
| Windows on ARM / Snapdragon / ARM64 | `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe` |
| Intel or AMD 64-bit Windows | `AI-Engineering-Control-Plane-Setup-x64-0.1.0.exe` |

If you are unsure: Windows **Settings → System → About → System type** shows whether the machine is ARM64 or x64.

## 2. Install

1. Double-click the downloaded `.exe`.
2. Use the default **per-user** installation unless you have a reason to change it.
3. Leave **Desktop shortcut** enabled if you want a desktop icon.
4. Finish the installer and open **AI Engineering Control Plane**.

### Windows SmartScreen note

The preview build may be unsigned. Windows can therefore show a SmartScreen warning even when the file came from this repository. Verify that you downloaded it from this repository's official Release and, if desired, compare its SHA-256 hash against `SHA256SUMS.txt` in the same Release. Do **not** globally disable Windows security.

## 3. First start

AECP shows one short welcome screen.

1. Click **Choose my first Workspace**.
2. Pick the local folder you want AECP to work with.
3. AECP automatically detects Git repositories at the Workspace root and its direct child folders.
4. AECP detects common local tools such as Git, PowerShell, Python, Node.js, GitHub CLI, and Ollama.

Choosing a Workspace does **not** upload the folder anywhere.

## 4. Open official ChatGPT

In the right-hand **Official ChatGPT Web** pane, click:

**Open official ChatGPT**

Your normal browser opens `chatgpt.com`. Sign in normally if needed. AECP does not receive your ChatGPT password, cookies, or session token.

## 5. Try the safe sample first

Back in AECP, click:

**Create sample task**

The task appears on the Board. Select it and press:

**Run locally**

The preview performs only a read-only operation:

- `inspect-workspace`, or
- `git-status` when the Workspace root itself is a Git repository.

After verification, the task moves to **Done**.

Open these views to understand what happened:

- **Board** — all tasks by state
- **Pipeline** — Understand → Prepare → Execute → Verify → Package Result
- **Graph** — Workspace ↔ repositories ↔ providers ↔ local tools
- **Trace** — exact local execution events (Engineering mode)
- **Evidence** — result and local evidence

## 6. Use ChatGPT → AECP → ChatGPT

The preview uses an explicit **Safe Bridge**.

### Ask ChatGPT for a Command Card

You can tell ChatGPT:

```text
Please output an AECP Command Card using schema aecp.task/v1.
Use only one of these preview actions:
- inspect-workspace
- git-status
Do not include any shell command.
```

Example:

```json
{
  "schema": "aecp.task/v1",
  "title": "Inspect Workspace",
  "workspace": "current",
  "goal": "Perform a read-only local inspection and return verified evidence.",
  "action": { "type": "inspect-workspace" },
  "permissions": ["workspace:read"],
  "verification": { "type": "operation-success", "expected": true }
}
```

Then:

1. Copy the JSON in ChatGPT.
2. In AECP click **Import from Clipboard**.
3. AECP validates the schema before creating a Task.
4. Select the Task and click **Run locally**.
5. Open **Evidence**.
6. Click **Copy Result Capsule**.
7. Paste it back into the same ChatGPT conversation.

AECP reads the clipboard only when you explicitly press **Import from Clipboard**.

---

# Interface guide

## Left — Local Computer

Shows only local information:

- active Workspace
- detected repositories
- Git branch / dirty-clean status
- local tools and versions
- Open Workspace
- Open Terminal (Engineering mode; user-initiated)

## Center — Control Plane

One canonical task model is shown in multiple professional engineering views:

- Board
- Pipeline
- Graph
- Trace
- Evidence

This design borrows mature concepts from software delivery pipelines and project control systems: explicit states, stage/step thinking, verification, failure visibility, and evidence.

## Right — Official ChatGPT Web

This is intentionally a companion pane, not a cloned ChatGPT UI. The button opens official ChatGPT in your normal browser. This keeps OpenAI authentication and UI independent from AECP.

---

# Providers and future model expansion

Click **Providers** in the top-right.

Built in:

- **ChatGPT Web** — no API key; explicit Safe Bridge

You can already register metadata for future:

- API provider
- Local provider
- Remote MCP provider

If you enter an API key, AECP stores it using Electron/Windows OS-protected `safeStorage`; plaintext is not written into the project repository. **v0.1.0 does not invoke those external APIs yet.** This is intentional: the Provider Registry exists now so future models can plug into the same Local Harness rather than forcing an architectural rewrite.

---

# What v0.1.0 deliberately does NOT do

To keep the first downloadable EXE safe and verifiable, it does not yet:

- execute arbitrary commands copied from an AI conversation
- modify/delete project files autonomously
- push Git commits to GitHub
- control arbitrary Windows GUI applications
- scrape or automate ChatGPT's DOM
- bypass ChatGPT usage limits
- invoke saved external API providers
- expose a local MCP server to the public internet
- offer remote/mobile execution

Those capabilities are specified as governed adapters/stages in `Blueprint/` and must be added behind explicit permissions, verification and evidence.

---

# Architecture / Blueprint

The full product source of truth is in [`Blueprint/`](Blueprint/INDEX.md).

Important files:

- `00_MASTER_BLUEPRINT.md`
- `01_UX_UI_SPEC.md`
- `02_LOCAL_AGENT_HARNESS.md`
- `03_PROVIDER_ROUTER.md`
- `04_SECURITY_AND_POLICY.md`
- `05_GITHUB_MULTI_REPO.md`
- `06_DESKTOP_CHATGPT_INTEGRATION.md`
- `07_INSTALL_RELEASE.md`
- `08_ROADMAP_ACCEPTANCE.md`
- `09_RESEARCH_NOTES.md`
- `10_CONVERSATION_DECISION_LOG.md`
- `11_TASK_PROTOCOL.md`
- `12_DATA_MODEL.md`
- `13_TRIPLE_AUDIT.md`

The founding requirement conversation and the resulting engineering decisions are archived under `Blueprint/Conversation/`.

---

# Developer setup

Ordinary users do **not** need this section.

Requirements:

- Node.js 24
- npm
- Windows for packaging Windows installers

```powershell
git clone https://github.com/Space653000/AI-Engineering-Control-Plane.git
cd AI-Engineering-Control-Plane
npm install
npm run verify
npm start
```

Build installers:

```powershell
npm run dist:x64
npm run dist:arm64
```

Output is written to `release/`.

## Security model for contributors

Renderer pages run with:

- context isolation enabled
- Node integration disabled
- sandbox enabled
- a narrow preload API

The official ChatGPT website is never loaded with a privileged AECP preload script.

---

# Automated builds and releases

Pull requests run:

1. syntax checks
2. Node unit tests
3. Windows x64 package build
4. Windows ARM64 package build

A merge/push to `main` builds both Windows installers. If that package version does not already have a GitHub Release, the release workflow publishes a GitHub **pre-release** containing:

- x64 installer
- ARM64 installer
- installer blockmaps
- `SHA256SUMS.txt`
- release notes

---

# Privacy

v0.1.0 has:

- no analytics SDK
- no telemetry
- no automatic source upload
- local task/evidence storage only
- explicit clipboard handoff

Local AECP application data is stored in the Electron per-user application-data directory shown by the app runtime.

---

# License

MIT. See [`LICENSE`](LICENSE).

# Status

This repository is an active preview. A `1.0.0` claim is blocked until the Blueprint's stable-release gates—including signed installers, broader harness adapters, migration/update testing, accessibility, and security review—are satisfied.
