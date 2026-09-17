# 06 — Official ChatGPT Desktop/Web Integration

## 1. Requirement

The user's existing official ChatGPT browser/PWA/Desktop usage must remain unaffected. AECP is a companion control plane, not a browser modification.

## 2. Supported baseline — External Browser Safe Bridge

AECP opens `https://chatgpt.com` using the system browser. The browser owns authentication, cookies, passkeys, extensions, updates and OpenAI UI behavior.

AECP never needs the ChatGPT cookie/session.

### Handoff sequence

1. User has a normal conversation in ChatGPT.
2. ChatGPT/user produces a structured Command Card.
3. User presses Copy in ChatGPT.
4. User presses `Import from Clipboard` in AECP.
5. AECP validates/does local work.
6. User presses `Copy Result`.
7. User pastes into ChatGPT.

No clipboard background monitoring is required.

## 3. Browser Dock UX

Goal: feel like one workstation while preserving process/origin separation.

Bootstrap:
- AECP can open ChatGPT externally.
- UI teaches Windows Snap (`Win+←/→`) and remembers AECP pane layout.

Future native dock adapter may position an external browser window using supported Windows APIs/UI Automation. It must not read ChatGPT message DOM.

## 4. Embedded mode

Not a release dependency. If explored later, it must satisfy all conditions:
- official origin displayed unchanged;
- no privileged preload on remote origin;
- no DOM/message scraping;
- no network interception;
- authentication works through supported browser behavior;
- clear provider identity;
- external-browser fallback always available.

## 5. Browser extension

A future minimal extension may provide safe bridge ergonomics only when allowed by browser-store/provider rules. It must not extract ChatGPT conversation content automatically. Suitable functions: identify current URL, explicit user-triggered handoff, open AECP via native messaging/deep link.

## 6. Official MCP path

OpenAI documentation states ChatGPT connects to remote MCP servers; local/private MCP requires a supported Secure MCP Tunnel path. Full write/modify MCP availability depends on plan/product support and may change. Therefore AECP treats MCP as an adapter, never as the only transport.

## 7. Why Safe Bridge remains permanent

Even after MCP/API integrations exist, Safe Bridge is valuable because it:
- needs no API key;
- does not depend on hidden APIs;
- provides a visible human authorization boundary;
- survives provider capability changes;
- works when an optional provider is unavailable.
