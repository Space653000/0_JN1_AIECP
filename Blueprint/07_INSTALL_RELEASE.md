# 07 — Install, Build and Release Blueprint

## 1. User goal

A non-developer downloads **one primary installer**, double-clicks it, and lets AECP automatically select the correct Windows payload. The user should not need to understand x64 vs ARM64, install Node.js, GitHub tooling, Rust, Python, or a local model before trying the Safe Bridge.

The first-run experience follows the same principle: automatically detect what can be detected safely; ask the user only when a choice is inherently personal or security-sensitive.

## 2. Windows targets

Primary:
- Windows 11 x64
- Windows 11 ARM64

AECP uses Electron + `electron-builder` NSIS. The **primary** release artifact is now a self-contained x64+ARM64 bootstrap installer. It detects the host architecture and launches the matching embedded NSIS payload:

- `AI-Engineering-Control-Plane-Setup-<version>.exe`

The installer contains both Windows payloads and selects the correct architecture automatically.

Fallback/debug artifacts remain available:

- `AI-Engineering-Control-Plane-Setup-x64-<version>.exe`
- `AI-Engineering-Control-Plane-Setup-arm64-<version>.exe`
- SHA-256 checksum manifest

The combined offline installer is preferred over an architecture-downloading web bootstrapper because it remains self-contained after download and continues to work even if the repository is later private or the user is temporarily offline during installation.

## 3. Automatic detection policy

AECP follows **detect first, ask only when necessary**.

Automatically detect:
- Windows runtime architecture (`x64` / `arm64`)
- application architecture
- system appearance preference for the initial theme
- Git
- PowerShell / PowerShell 7
- Python
- Node.js
- GitHub CLI
- Ollama
- Git repositories inside the approved Workspace boundary
- branch / dirty-clean status
- existing saved AECP Workspace on later launches

Do **not** automatically guess a first Workspace by scanning the user's whole disk. The initial Workspace is the one intentional authorization boundary that the user must choose. This avoids silently indexing personal folders or unrelated repositories.

Once a Workspace has been chosen, AECP remembers it locally and reopens it on later launches unless the user changes it.

## 4. Installer behavior

- one primary auto-detect installer for ordinary users
- x64 and ARM64 fallback installers for troubleshooting
- per-user install by default; no Administrator requirement
- Start Menu shortcut
- optional Desktop shortcut through installer UI
- uninstall entry
- preserve user configuration/evidence unless user explicitly chooses to remove data
- no background service in bootstrap release
- no auto-start unless user explicitly enables it later

## 5. First-run behavior

Expected newcomer flow:
1. Download the primary auto-detect installer.
2. Double-click it; architecture selection is automatic.
3. Launch AECP.
4. AECP starts in Beginner mode.
5. Theme follows system preference unless the user has already chosen one.
6. AECP performs local environment/tool detection.
7. User chooses one Workspace folder.
8. AECP automatically detects repositories and Git state inside that boundary.
9. User opens official ChatGPT in the normal browser.
10. User runs the safe sample task and inspects Evidence.

After the first Workspace is saved, subsequent launches should require no setup for the normal Safe Bridge path.

## 6. Code signing

Stable public distribution uses the owner-gated Authenticode lane. Repository software now supports signer-thumbprint pinning, signed x64/ARM64 NSIS builds, signed Universal Bootstrap preparation, signature verification and signed provenance. The repository does not contain or fabricate a production certificate: actual certificate ownership/secrets and an owner-authorized signed publication are **EXTERNAL OWNER GATE** operations. Until such a certificate is supplied, preview releases remain explicitly unsigned and may trigger Windows SmartScreen. Never instruct users to disable Windows security globally.

## 7. Release automation

GitHub Actions performs:
1. canonical verification, license/requirements/Blueprint/acceptance audits
2. package x64 and ARM64 NSIS installers
3. assemble the self-contained x64+ARM64 architecture-selecting bootstrap
4. build and manifest-validate x64/ARM64 Store AppX packages with a non-production test identity
5. execute clean x64/ARM64 install/uninstall smoke tests
6. execute real installer baseline → upgrade → rollback smoke tests on x64 and ARM64
7. execute Universal Bootstrap install/uninstall smoke on x64 and ARM64
8. generate SHA-256 manifests and release provenance from the exact checked-out source commit
9. upload workflow evidence artifacts
10. publish only on an explicit version tag; PRs run the same release lane as a non-publishing dry-run
11. provide separate owner-gated Store and Authenticode signed-release workflows without storing production credentials in the repository

Workflow permissions are minimum necessary (`contents: write` only in release job; read elsewhere).

## 8. Versioning

Semantic Versioning:
- `0.x` = preview; architecture/protocol may change
- `1.0.0` = stable Safe Bridge + policy + evidence + signed installer + upgrade/backup story

Command/Result protocol has its own schema version independent of app version.

## 9. Update strategy

The private GitHub Release updater is implemented: it selects a compatible release asset, verifies SHA-256, retains a verified rollback installer when available, records a durable update transaction, reconciles first boot, and can roll back when the installed version does not match the verified target. Stable/signed builds can additionally pin an Authenticode signer thumbprint; when a signer pin is configured, both target and rollback installers must pass Authenticode validation before execution. Production certificate ownership and a real signed-release run remain an **EXTERNAL OWNER GATE**.

## 10. Release checklist

A release is blocked unless:
- static/unit verification passes
- x64 fallback build passes
- ARM64 fallback build passes
- combined auto-detect installer build passes
- combined installer actually contains/selects x64 and ARM64 payloads as shown by build evidence
- app launches in packaged smoke test where available
- no secrets in repository
- Blueprint audit is current
- README install steps match actual artifact names
- checksum produced
- unsigned/signed state clearly documented
- installer does not require developer dependencies

## 11. New-user test script

On a clean Windows account:
1. Download `AI-Engineering-Control-Plane-Setup-<version>.exe` from Releases.
2. Install using defaults; do not manually select CPU architecture.
3. Launch AECP.
4. Confirm app architecture is displayed and local tools are automatically detected.
5. Choose a first Workspace.
6. Confirm repositories/Git state appear automatically.
7. Click `Open official ChatGPT`.
8. Create/import a safe Command Card.
9. Run the read-only sample task.
10. Verify Trace/Evidence/Result Capsule.
11. Close and reopen AECP; confirm the saved Workspace returns without reconfiguration.
12. Uninstall and confirm application binaries are removed.
