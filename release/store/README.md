# Microsoft Store software-side preparation

This directory contains the repository-owned portion of the Microsoft Store Private Audience lane.

## Repository-verifiable work

- `package.json` defines the AppX build target for x64 and ARM64.
- PR Packaging builds both Store packages with a non-production test identity.
- `scripts/validate-store-package.ps1` opens the generated package and verifies Identity, Publisher, architecture, executable, `runFullTrust`, and SHA-256 evidence.
- `.github/workflows/store-package.yml` accepts the exact Partner Center identity values from the owner and produces an owner-identity x64/ARM64 submission bundle.
- The workflow produces `SHA256SUMS-store.txt` and `STORE_PROVENANCE.json`.
- The workflow never submits to Partner Center.

## EXTERNAL OWNER GATE

The repository cannot create or fake:

1. Partner Center app reservation / publisher identity.
2. Microsoft Store certification.
3. Private audience account assignment.
4. Acquisition from a real clean Windows account/device.
5. Microsoft publisher trust shown after Store acquisition.

Run **AECP Store Package** manually only after obtaining the exact Partner Center Identity Name, Publisher, and Publisher Display Name. Use the resulting artifact bundle for the owner-controlled Partner Center submission.

The GitHub Preview/NSIS release channel remains independent from this Store lane.
