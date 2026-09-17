# 10 — Founding Conversation and Decision Log

Date: 2026-09-17

Purpose: preserve the complete product intent from the founding discussion in a compact engineering form. This is a project-specific record, independent from prior unrelated projects.

## Conversation 1 — Initial concept

User requirement:
- A local Windows application should use official ChatGPT Web as the cloud reasoning surface.
- The local computer should provide CPU/GPU, files, desktop, terminal and tools.
- Prefer the existing ChatGPT subscription experience rather than paying per-token API costs.
- The system should continue operating locally with only power/network and explicit ChatGPT handoff.
- Asked whether existing GitHub/open-source projects exist and whether a custom system can be built if necessary.

Decision:
- Separate cloud reasoning from local execution.
- Research existing desktop-agent/MCP/Windows-control patterns, but own the security boundary and orchestration layer.
- Avoid dependence on web DOM automation/private APIs.

## Conversation 2 — Three-pane engineering desktop

User proposed:
- left side: real/local desktop and engineering environment;
- right side: official ChatGPT Web, potentially switching among official capabilities such as Chat/Codex where the product exposes them;
- center: graphical MCP/tool/context connections;
- drag/connect conversations, folders and tools so the software automatically establishes relationships;
- connect multiple GitHub repositories.

Decisions:
- three-pane Workspace Shell;
- center evolves from an MCP list into a **Control Plane / Local Fabric**;
- Graph edges are real capability bindings;
- support multiple repositories per Workspace;
- maintain a canonical Context/Task state so tools/providers do not require repeated manual re-explanation.

## Conversation 3 — New independent project and cloud-minimal objective

User clarified:
- this is a completely new project unrelated to previous work;
- official ChatGPT Web is the preferred cloud UI;
- avoid separate API-token billing by default;
- avoid wasting limited cloud usage/traffic by letting local CPU/GPU do bulk work.

Decisions:
- product must not try to evade official service limits;
- minimize cloud context through local indexing/reduction and Context Capsules;
- Safe Bridge requires explicit user handoff rather than automated extraction;
- local execution should handle 80–95% of mechanical/high-volume work when practical, leaving high-value reasoning to the supervisor.

## Conversation 4 — UX, engineering harness and future providers

User added:
1. UX/UI should feel familiar to current ChatGPT and can identify the official ChatGPT provider with its proper symbol/label where branding permits.
2. Research Harness/kanban/professional software-engineering concepts to make the control plane rigorous.
3. Future external API keys should be attachable, and models/providers should be extensible like a provider router rather than hard-coded.
4. Official ChatGPT browser/local web must remain unaffected; AECP only attaches around it. Desired experience should feel as smooth as remote Codex-style supervision of local work, but driven by web conversation and a local operating model.

Decisions:
- adopt pipeline Stage/Step, timeout, condition, failure strategy, verification and manual gate concepts;
- Board/Pipeline/Graph/Trace are projections of one canonical task model;
- Provider Registry supports ChatGPT Web, official MCP, API providers and local providers;
- API secrets stored through OS protection and opaque credential references;
- default Browser Safe Bridge never modifies ChatGPT;
- remote/mobile experience is a future authenticated gateway, not a scraper.

## Conversation 5 — Naming and formal delivery request

User named the architecture/project:

**AI Engineering Control Plane**

Requested:
- convert all discussions, architecture, interfaces, UX/UI, tools and research into a rigorous Blueprint;
- create a dedicated `Blueprint/` directory in `Space653000/AI-Engineering-Control-Plane`;
- use that repository as the full development repository;
- make the end product beginner-friendly: download an `.exe`, put/install it on Windows and use it intuitively;
- perform three independent Blueprint-vs-implementation checks;
- update README with very clear beginner installation/use instructions;
- state whether the repository can safely be made private after delivery.

Decisions:
- `Blueprint/` is the formal source of truth;
- implementation is developed on a feature branch, CI-checked, then merged;
- GitHub Actions builds Windows x64 and ARM64 artifacts;
- README must distinguish preview/unsigned release limitations from stable claims;
- triple audit results are committed in `13_TRIPLE_AUDIT.md`.

## Founding non-negotiables

1. Official ChatGPT remains official and unmodified.
2. Default operation has zero separate OpenAI API-key requirement.
3. No mechanism is built to bypass usage limits or programmatically harvest ChatGPT output.
4. Local project data stays local by default.
5. Local Harness is permanent; AI/model/provider is replaceable.
6. User-visible permissions, verification and evidence take precedence over autonomous convenience.
7. Windows ARM64 is a first-class target, not an afterthought.
8. Multi-repo and future multi-provider design is present from the architecture level.
