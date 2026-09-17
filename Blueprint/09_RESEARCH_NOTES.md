# 09 — Research Notes and Adopted Patterns

Research date: 2026-09-17.

This file records external concepts that shaped AECP. References are informational; AECP is not affiliated with these products.

## OpenAI — Developer mode / MCP apps

Reference: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

Key findings adopted:
- ChatGPT connects to remote MCP servers rather than directly to a local MCP server.
- Secure MCP Tunnel is the documented path for supported products to reach private/on-prem/developer-machine MCP servers without public exposure.
- Full write/modify MCP availability is plan/product dependent and can change.

Design consequence: Safe Bridge is permanent; official MCP is an optional transport adapter rather than a foundation assumption.

## OpenAI — Terms / service restrictions

Reference: https://openai.com/policies/terms-of-use/

Key findings adopted:
- no automated/programmatic extraction of service data/output;
- no circumvention of rate limits/restrictions/protective measures;
- no reverse engineering of service/model internals.

Design consequence: no ChatGPT DOM scraper, hidden private API, session-cookie extraction, quota bypass, or automated output harvesting.

## GitHub Projects

References:
- https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
- https://docs.github.com/en/rest/projects/views

Key pattern: the same work items can be projected into table, board and roadmap views with filtering/grouping/custom fields.

Design consequence: AECP Board, Pipeline, Graph and Trace are views over one canonical state model rather than separate databases.

## Harness Software Delivery Platform

References:
- https://developer.harness.io/docs/platform/pipelines/add-a-stage/
- https://developer.harness.io/docs/category/failure-handling/

Key patterns:
- stage/step hierarchy;
- conditional execution;
- timeout;
- retry/abort/rollback/failure strategies;
- manual gates;
- evidence/status as part of execution.

Design consequence: AECP Local Agent Harness treats tasks as governed pipelines rather than an unbounded agent loop.

## Electron security

References:
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/context-isolation

Key patterns:
- context isolation;
- renderer sandbox;
- Node integration disabled for renderer;
- narrow preload/contextBridge APIs;
- validate navigation and IPC.

Design consequence: all local privileged actions live in the trusted main/Harness layer, never directly in UI JavaScript.

## electron-builder Windows / ARM64

References:
- https://www.electron.build/docs/architecture/
- https://www.electron.build/nsis/

Key findings:
- Windows x64 and ARM64 are supported targets;
- Windows ARM64 can be cross-packaged from x64 when dependencies permit;
- NSIS supports Windows installers and multi-arch packaging.

Design consequence: bootstrap avoids native Node modules and produces distinct x64/ARM64 installers for clarity.

## Pattern synthesis

AECP combines:
- conversational supervisor UX;
- software-delivery pipeline discipline;
- project-management multi-view state;
- local security boundary;
- provider/tool adapters;
- evidence-driven completion.

The differentiator is not a new foundation model. It is the local engineering control plane around interchangeable intelligence providers.
