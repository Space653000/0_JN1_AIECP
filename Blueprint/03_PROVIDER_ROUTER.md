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

### External API providers — future optional

Examples: OpenAI API, Anthropic, Gemini, enterprise gateways.

Type: `api`

Each implements the same capabilities and may be assigned to supervisor/worker/reviewer roles.

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

or later:

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
- Credentials use OS-protected secure storage (Electron `safeStorage` on Windows bootstrap; future Windows Credential Manager adapter acceptable).
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
