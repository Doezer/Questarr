# GitHub Documentation Map (Canonical)

This file is the single entry point for GitHub-facing documentation in this repository.

- Product overview and setup: [`README.md`](../README.md)
- Contribution guide: [`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md)
- Security policy and reporting: [`.github/SECURITY.md`](../.github/SECURITY.md)
- API reference: [`docs/API.md`](./API.md), for the REST/Socket.io interface reference
- Architecture: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), for a system architecture and actor overview
- Changelog: [`docs/CHANGELOG.md`](./CHANGELOG.md)
- Migration notes: [`docs/MIGRATION.md`](./MIGRATION.md), for migration from PostgreSQL to SQLite in v1.1
- Security model and operations:
  - [`docs/THREAT_MODEL.md`](./THREAT_MODEL.md), for the attack surface analysis and security architecture
  - [`docs/SECURITY_ASSESSMENT.md`](./SECURITY_ASSESSMENT.md), security risk assessment.
  - [`docs/VULNERABILITY_MANAGEMENT.md`](./VULNERABILITY_MANAGEMENT.md), for the SCA/SAST remediation policy and release gates
  - [`docs/SECRETS.md`](./SECRETS.md), for details on how API keys, indexer/downloader credentials, and other secrets are stored and managed.
  - [`docs/SBOM.md`](./SBOM.md): Every published image ships with a Software Bill of Materials.
  - [`docs/VEX.md`](./VEX.md), for details on the Questar's Vulnerability Exploitability Exchange feed
  - [`docs/DEPENDENCIES.md`](./DEPENDENCIES.md), for how dependencies are selected, obtained, and tracked.
- `.github/CODE_OF_CONDUCT.md` (community health file)
