# Unified AI Portfolio

本目錄是跨專案的總索引與整合層，不是新的產品實作倉庫，也不取代任何專案自己的權威藍圖。

適用範圍（不含 Robotcar）：
- AERIS Core — Space653000/0_JN1_AERIS
- AERIS Local Implementation — Space653000/0_JN1_AERIS_Local-computer-implementation
- AERIS Supervision — Space653000/0_JN1_AERIS_Supervision
- Offline Local Voice Agent — Space653000/Offline-Local-Voice-Agent
- MEGIS — Space653000/0_JN1_MEGIS
- AECP — Space653000/0_JN1_AIECP
- SuperBrain — Space653000/0_JN1_2AGAVE128-1MAERA64

## Read order
1. 00_MASTER_AI_PORTFOLIO_BLUEPRINT.md
2. 01_AUTHORITY_SOURCE_OF_TRUTH_MATRIX.md
3. 02_INTEGRATION_AND_HANDOFF_CONTRACTS.md
4. 03_PUBLIC_PORTAL_BLUEPRINT.md

## Governing principle
Cross-project integration may define how systems connect, but不得 silently redefine domain truth.

AERIS acoustic truth remains governed by AERIS Core.
MEGIS mechanical/generative-engineering truth remains governed by MEGIS.
Voice-Agent remains the local voice/HMI product.
SuperBrain remains the multi-computer/local-compute fabric.
AECP remains the engineering control plane/orchestrator.
AERIS Supervision remains audit/snapshot publication and reconciliation support.

If this Portfolio layer conflicts with a project-specific canonical blueprint on domain behavior, the project-specific canonical blueprint wins.
