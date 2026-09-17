# AI Engineering Control Plane v0.1.0 — Preview

This is the first architecture-aligned preview build.

## Recommended download

Ordinary Windows users should download only:

`AI-Engineering-Control-Plane-Setup-0.1.0.exe`

This is the primary **Auto-Detect** installer. It contains both x64 and ARM64 Windows payloads and automatically chooses the correct architecture during installation.

Architecture-specific installers remain attached only as troubleshooting fallbacks:

- `AI-Engineering-Control-Plane-Setup-x64-0.1.0.exe`
- `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe`

## What works

- one primary auto-detect Windows x64 + ARM64 installer
- Windows x64 and Windows ARM64 fallback installers
- native Workspace folder selection
- automatic restore of the saved Workspace on later launches
- local Git repository detection (Workspace root and direct child folders)
- local Git branch / dirty-clean inspection
- local tool detection (Git, PowerShell, Python, Node.js, GitHub CLI, Ollama)
- application architecture display
- three-pane Local / Control Plane / Official ChatGPT workflow
- official ChatGPT opens in the normal system browser; AECP does not inject or scrape it
- explicit clipboard Safe Bridge
- versioned read-only Command Cards (`inspect-workspace`, `git-status`)
- Task Board, Pipeline, Workspace Graph, Execution Trace and Evidence views
- local Result Capsule generation and explicit copy-back
- optional Provider Registry with OS-protected API-key storage
- dark/light and Beginner/Engineering modes

## First-run rule

AECP automatically detects what is safe to detect. The one intentional first-run manual choice is the Workspace folder because that folder is the local authorization boundary. AECP does not scan the user's entire disk to guess which private files or repositories should be exposed.

## Important preview limitations

- This build deliberately does **not** execute arbitrary AI-provided shell commands or modify project files.
- Desktop UI automation, worktree-per-task, official MCP, API-provider invocation, local-model workers and remote/mobile supervision are roadmap capabilities.
- Installers are unsigned unless the repository owner adds an Authenticode signing process. Windows SmartScreen may therefore warn.
- No telemetry is included.

See `README.md` for the beginner first-run procedure and `Blueprint/` for the complete product architecture and acceptance roadmap.
