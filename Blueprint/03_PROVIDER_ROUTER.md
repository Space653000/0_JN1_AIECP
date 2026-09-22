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

## 2A. Provider versus Worker

AECP formally separates **Provider** from **Worker**.

- Provider = intelligence/API/model source and its capability, health, credential and usage contract.
- Worker = a concrete isolated execution process that receives a governed Task through Harness.

Canonical workers introduced by the Multi-Worker extension:

```yaml
codex-official:
  provider: openai-official
  runtime: codex-cli
  codex_home: dedicated

codex-pega:
  provider: pega
  runtime: codex-cli
  codex_home: dedicated
```

The two workers must never share `CODEX_HOME`, auth, session or runtime state.

### PEGA Provider Adapter

PEGA is a normal Provider Adapter, not a Harness special case.

```yaml
id: pega
kind: api
base_url: https://aiapi.t-cyber.com/v1
```

The adapter must negotiate and verify the API family actually available in the environment, including Chat Completions-compatible and Responses-compatible behavior where supported. Unsupported capability combinations fail closed.

No PEGA-specific branch is permitted in Task/Mission/Queue/Harness state-machine logic. Future company/OpenAI/Gemini/Qwen/local providers must remain swappable through the same abstraction.

## 3. Adapter interface

Runtime contract:

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

Failure of an optional provider must not prevent Safe Bridge use. The current router exposes these five states through bounded health checks: fixed CLI/local-command checks never execute task text; API/Remote MCP live probes require explicit NETWORK approval, and stored credentials require explicit CREDENTIAL approval. An unapproved live probe reports `DEGRADED` rather than silently using network/credentials.

## 7. Cost/usage observability

For executable/API providers, AECP stores only privacy-safe invocation metadata locally:
- request count and success/failure count;
- model/role identifiers;
- latency;
- numeric token/cost metadata returned by the provider when available.

The durable usage store is bounded and serialized; prompt text, response bodies, credentials and error message bodies are not persisted as usage telemetry. For ChatGPT Web, AECP does not infer or scrape hidden usage counters; UI shows only `subscription-managed externally`.

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