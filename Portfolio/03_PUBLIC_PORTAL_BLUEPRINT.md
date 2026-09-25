# 03 — Unified Public Portal Blueprint

## 1. Goal
Turn the current small AERIS-facing public site into one AI Engineering Portfolio Portal while preserving product identity and security boundaries.

The public site is not the private control plane.

## 2. Recommended information architecture
- /
- /overview
- /architecture
- /projects/aeris
- /projects/megis
- /projects/voice-agent
- /projects/superbrain
- /projects/aecp
- /workflow
- /trust
- /status
- /roadmap
- /docs
- /changelog

## 3. Home page
The home page should answer:
1. What is this portfolio?
2. What are the five systems?
3. How do they connect?
4. What is real/verified today?
5. Where can I drill down?

Suggested headline:
AI Engineering Portfolio
Voice → Control Plane → Domain Engineering → Local Compute → Evidence

Project cards:
- AERIS — Acoustic Engineering OS
- MEGIS — Generative Mechanical Engineering
- Voice Agent — Offline Voice/HMI
- SuperBrain — Multi-PC Local AI Fabric
- AECP — Engineering Control Plane

## 4. Architecture page
Show one simple diagram:
Human
→ Voice Agent
→ AECP
→ AERIS / MEGIS / SuperBrain
→ Evidence / Git / CI / Review

Explicitly label presentation, orchestration, domain intelligence, compute fabric and evidence/governance.

## 5. Standard project page template
Every project page should use the same sections:
- What it is
- Why it exists
- What it owns
- Architecture
- Current verified capability
- Current unverified/blocked scope
- Blueprint
- Acceptance rules
- Current status
- Demo/screenshots
- Integration points
- Changelog

## 6. Trust page
Expose the shared rules:
- Evidence > self-report
- Execution != Completion
- Dashboard != Truth
- Model != Identity
- CI != real-machine acceptance
- Human final authority
- Local-first/private-by-default

## 7. Status page
Do not manually type progress percentages.

Generate status from manifests, project status and evidence. Each card should show blueprint revision, runtime/package version, phase/gate, latest verified scope, latest CI/evidence time, blockers and canonical GitHub references.

## 8. Public/private boundary
Never publish secrets/tokens, customer/project identifiers, raw engineering datasets, private filesystem paths, credential state, unpublished test artifacts, or detailed attack-surface/security settings.

## 9. SEO/indexing
Minimum:
- semantic URLs
- per-page title and description
- canonical URL
- OpenGraph metadata
- JSON-LD
- robots.txt
- sitemap.xml
- internal navigation
- accessible heading hierarchy
- useful server-rendered/static text

## 10. Migration plan
Phase 1 — preserve current AERIS Dashboard as a dedicated AERIS page.
Phase 2 — add Portfolio Home.
Phase 3 — normalize AERIS, MEGIS, Voice Agent, SuperBrain and AECP project pages.
Phase 4 — generate evidence-backed read-only status.
Phase 5 — publish sitemap/robots/meta and resubmit Search Console.

## 11. Deployment boundary
The AERIS repository contains static UI files, but Cloudflare deployment ownership/configuration must be verified before treating a GitHub change as live deployment.

Recommended separation:
- Public Portal: Cloudflare Worker/Pages or equivalent read-only public service.
- Private AECP Dashboard: localhost/private network only.
- Project runtimes: never exposed merely to support the public website.
