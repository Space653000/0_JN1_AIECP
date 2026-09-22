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

The Windows desktop adapter can position an allowlisted external browser window by process/window handle behind policy approval. It does **not** read ChatGPT DOM/messages/cookies or intercept browser traffic. Read-only Windows UI Automation for general apps is separate and browser/ChatGPT automation-tree inspection is denied by default.

## 4. Embedded mode — non-goal / optional exploration

Embedded ChatGPT is not required for AECP completion. If ever explored, it must satisfy all conditions:
- official origin displayed unchanged;
- no privileged preload on remote origin;
- no DOM/message scraping;
- no network interception;
- authentication works through supported browser behavior;
- clear provider identity;
- external-browser fallback always available.

## 5. Browser extension

A browser extension is optional and not required for the product loop. If added, it may provide only explicit safe-bridge ergonomics allowed by browser/provider rules and must never extract ChatGPT conversation content automatically.

## 6. Official MCP path

AECP includes an authenticated local MCP foundation. Any official ChatGPT-to-private-local transport still depends on supported product/tunnel deployment and external identity/TLS configuration. Full write/modify transport is never assumed; AECP treats MCP as one adapter, not the only transport.

## 7. Why Safe Bridge remains permanent

Even after MCP/API integrations exist, Safe Bridge is valuable because it:
- needs no API key;
- does not depend on hidden APIs;
- provides a visible human authorization boundary;
- survives provider capability changes;
- works when an optional provider is unavailable.
