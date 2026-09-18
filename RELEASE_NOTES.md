# AI Engineering Control Plane v0.2.0 — Preview

v0.2 focuses on resolving the two biggest v0.1 limitations without compromising the original product goal.

## Recommended download

Ordinary Windows users should download only:

`AI-Engineering-Control-Plane-Setup-0.2.0.exe`

The Auto-Detect installer contains both x64 and ARM64 payloads. Architecture-specific installers remain troubleshooting fallbacks.

## New in v0.2

### Three execution modes
- **Web Safe Bridge** — works with normal ChatGPT Web and remains the universal fallback.
- **Local Autonomous** — recommends a detected local/CLI worker when available.
- **Official Full MCP** — architecture for supported ChatGPT workspaces using an approved MCP/tunnel path.

### Local MCP foundation
- authenticated loopback MCP server
- binds only to `127.0.0.1`
- OS-encrypted persistent bearer token
- explicit Start / Stop / Copy connection UI
- read-only tools:
  - `aecp_status`
  - `inspect_workspace`
  - `git_status`
  - `read_text_file`
- rejects absolute/traversal paths outside the active Workspace
- 256 KiB text-file limit
- no raw shell, write, delete or push tools

### Agent/worker expansion
AECP now detects and can launch:
- ChatGPT Web
- Codex CLI
- Claude Code
- Gemini CLI
- OpenCode
- Ollama

The presence of a worker does not grant it extra filesystem or policy permissions.

### Constraint-resolution architecture
- Microsoft Store Private Audience is the preferred future path for removing SmartScreen friction without making the repository public.
- GitHub Preview distribution remains independent.
- Goal/Done/Evidence stays canonical across Web Safe Bridge, Local Autonomous and Official Full MCP modes.

## Verification added
CI includes a Local MCP integration test that:
1. starts the server on loopback;
2. verifies `/healthz`;
3. confirms an unauthenticated MCP request returns HTTP 401;
4. shuts the server down.

PR CI must also continue to build:
- Auto-Detect x64 + ARM64 installer
- x64 fallback
- ARM64 fallback

## Preview limitations

This release still deliberately does **not** claim:
- autonomous arbitrary file modification;
- unrestricted shell execution;
- unattended Git push/release;
- arbitrary Windows GUI control;
- end-to-end Secure MCP Tunnel against the user's real ChatGPT workspace;
- Microsoft Store certification;
- Authenticode signing.

Those are governed acceptance gates, not hidden features.

No telemetry is included.
