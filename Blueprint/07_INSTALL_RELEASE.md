# 07 — Install, Build and Release Blueprint

## 1. User goal

A non-developer downloads an installer, double-clicks it, installs AECP, and starts using the Safe Bridge without installing Node.js, GitHub tooling, Rust, Python, or a local model. Git itself is optional for non-repository use; AECP explains missing optional dependencies rather than failing cryptically.

## 2. Windows targets

Primary:
- Windows 11 x64
- Windows 11 ARM64

The first public build uses Electron + `electron-builder` NSIS. Electron-builder supports Windows ARM64 and can cross-package Windows ARM64 from an x64 Windows build host when native binary dependencies are avoided.

Artifacts:
- `AI-Engineering-Control-Plane-Setup-x64.exe`
- `AI-Engineering-Control-Plane-Setup-arm64.exe`
- SHA-256 checksum manifest

A future combined x64+ARM64 NSIS installer is possible, but separate installers make architecture/debugging explicit during early releases.

## 3. Installer behavior

- per-user install by default; no Administrator requirement
- Start Menu shortcut
- optional Desktop shortcut through installer UI
- uninstall entry
- preserve user configuration/evidence unless user explicitly chooses to remove data
- no background service in bootstrap release
- no auto-start unless user explicitly enables it later

## 4. Code signing

Stable public distribution should use Authenticode code signing. Until a certificate is configured, releases must clearly say **unsigned preview build** and document that Windows SmartScreen may warn. Never instruct users to disable Windows security globally.

## 5. Release automation

GitHub Actions performs:
1. dependency install (`npm ci` once lockfile exists)
2. static syntax/config checks
3. package x64
4. package ARM64
5. hash artifacts
6. upload workflow artifacts
7. for designated release commit/tag, create GitHub Release and attach installers/checksums

Workflow permissions are minimum necessary (`contents: write` only in release job; read elsewhere).

## 6. Versioning

Semantic Versioning:
- `0.x` = preview; architecture/protocol may change
- `1.0.0` = stable Safe Bridge + policy + evidence + signed installer + upgrade/backup story

Command/Result protocol has its own schema version independent of app version.

## 7. Update strategy

Bootstrap release uses explicit GitHub Releases/manual update. Auto-update is deferred until code signing, rollback and update-signature verification are designed and tested.

## 8. Release checklist

A release is blocked unless:
- x64 build passes
- ARM64 build passes
- app launches in packaged smoke test where available
- no secrets in repository
- Blueprint audit is current
- README install steps match actual artifact names
- checksum produced
- unsigned/signed state clearly documented
- installer does not require developer dependencies

## 9. New-user test script

On a clean Windows account:
1. Download correct `.exe` from Releases.
2. Install using defaults.
3. Launch AECP.
4. Complete first-run Workspace selection.
5. Click `Open ChatGPT`.
6. Paste sample Command Card into clipboard and import it.
7. Run read-only sample task.
8. Verify trace/result.
9. Copy Result Capsule.
10. Uninstall and confirm application binaries are removed.
