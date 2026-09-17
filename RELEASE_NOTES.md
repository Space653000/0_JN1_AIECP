# AI Engineering Control Plane v0.1.0 — Preview

This is the first architecture-aligned preview build.

## What works

- Windows x64 and Windows ARM64 installers
- native Workspace folder selection
- local Git repository detection (Workspace root and direct child folders)
- local tool detection (Git, PowerShell, Python, Node.js, GitHub CLI, Ollama)
- three-pane Local / Control Plane / Official ChatGPT workflow
- official ChatGPT opens in the normal system browser; AECP does not inject or scrape it
- explicit clipboard Safe Bridge
- versioned read-only Command Cards (`inspect-workspace`, `git-status`)
- Task Board, Pipeline, Workspace Graph, Execution Trace and Evidence views
- local Result Capsule generation and explicit copy-back
- optional Provider Registry with OS-protected API-key storage
- dark/light and Beginner/Engineering modes

## Important preview limitations

- This build deliberately does **not** execute arbitrary AI-provided shell commands or modify project files.
- Desktop UI automation, worktree-per-task, official MCP, API-provider invocation, local-model workers and remote/mobile supervision are roadmap capabilities.
- Installers are unsigned unless the repository owner adds an Authenticode signing process. Windows SmartScreen may therefore warn.
- No telemetry is included.

See `Blueprint/` for the complete product architecture and acceptance roadmap.
