# 03 — Provider Router

## 1. Goal

The Local Agent Harness must not care which intelligence provider produced a task. Providers are adapters around a common capability contract.

## 2. Provider classes

### ChatGPT Web — default supervisor

Type: `human-mediated-web`

Ingress/egress uses explicit user gestures (Command Card import / Result Capsule copy). AECP does not programmatically extract ChatGPT output.

Cost model: user's ChatGPT subscription; no API token billing from AECP.

### Official MCP — optional

Type: `remote-mcp`

Used only through supported official OpenAI mechanisms and account capabilities. ChatGPT connects to remote MCP endpoints; a local server requires an official/secure tunnel mechanism rather than an assumed direct localhost connection.

### External API providers — optional and governed

Examples include OpenAI-compatible APIs, enterprise gateways and supported cloud CLIs. Type: `api`. The current router supports governed OpenAI-compatible endpoints behind NETWORK/CREDENTIAL approval, while vendor-specific adapters may implement the same contract without changing Task state.

### Local providers — optional

Examples: Ollama-compatible local models, local embedding, STT/OCR/vision services.

Type: `local`

Best for bounded, high-volume preprocessing rather than mandatory central reasoning.

## 3. Adapter interface

Conceptual interface:

```ts
interface ProviderAdapter {
  id: string;
  kind: 'human-mediated-web' | 'remote-mcp' | 'api' | 'local';
  capabilities(): ProviderCapabilities;
  health(): Promise<ProviderHealth>;
  invoke?(request: ProviderRequest): AsyncIterable<ProviderEvent>;
  cancel?(runId: string): Promise<void>;
}
```

ChatGPT Web intentionally does not implement hidden `invoke()` automation. It exposes a handoff workflow.

## 4. Role routing

Workspace policy can specify:

```yaml
providers:
  supervisor: chatgpt-web
  worker: local-default
  reviewer: chatgpt-web
```

or equivalently:

```yaml
providers:
  supervisor: openai-api-main
  worker: local-qwen
  reviewer: anthropic-review
```

No task-state or tool code changes when roles change.

## 5. Credential handling

- API keys never live in repository YAML/JSON.
- Provider configuration stores only `credentialRef`.
- Credentials use OS-protected secure storage (Electron `safeStorage` on Windows); a Windows Credential Manager adapter is optional, not required for the current security boundary.
- UI only returns masked key metadata, never plaintext after save.
- Secrets are injected into the provider process/request in memory.
- Evidence/trace redaction runs before persistence.

## 6. Provider health

States:
- `NOT_CONFIGURED`
- `READY`
- `DEGRADED`
- `UNAVAILABLE`
- `AUTH_REQUIRED`

Failure of an optional provider must not prevent Safe Bridge use.

## 7. Cost/usage observability

For API providers, store locally:
- request count
- model name
- token/cost metadata returned by provider when available
- latency

For ChatGPT Web, AECP must not infer or scrape hidden usage counters. UI shows only `subscription-managed externally`.

## 8. Failover

Failover never silently moves private local context to a cloud provider. Any provider change that changes the data boundary requires explicit user approval or a predeclared policy.


## 8. Role-based routing

AECP routes by stable engineering role rather than vendor brand:

```yaml
roles:
  supervisor: chatgpt-web
  planner: claude-code
  builder: codex-cli
  reviewer: claude-code
  verifier: deterministic-local
  local_compute: ollama
```

Any role may be remapped without changing Task state, Workspace policy or Evidence schemas, subject to provider capability/policy checks.

## 9. Agent adapter contract

Provider adapters expose only capabilities they can actually verify. A detected CLI is not automatically an enabled writer. Read, write, review, execute, network and publish capabilities are separate.

## 10. Inter-agent handoff

Agents never exchange hidden vendor sessions. They exchange Goal/Plan/Task/Context/Worker-Report/Review/Result artifacts with schema versions and correlation IDs.

## 11. Cost/attention control

The Harness optimizes verified engineering progress per unit of human attention. It must not create extra model calls merely to keep agents busy.