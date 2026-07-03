# Security Policy

## Supported Versions

Use the latest version of this project to ensure you have the latest security patches.

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not report it publicly. Instead, please report it via email to the maintainer directly.

## Threat Model

See [docs/THREAT_MODEL.md](../docs/THREAT_MODEL.md) for the system's attack surface analysis, trust boundaries, and known residual risks. This is the canonical reference for security-relevant architectural decisions, and should be updated alongside any change that adds a new external integration, trust boundary, or unauthenticated route.

For a full inventory of how secrets and credentials are stored, accessed, and rotated throughout the codebase, see [docs/SECRETS.md](../docs/SECRETS.md).

Vulnerabilities reported against a component Questarr ships (an npm dependency or the container base image) that do not actually affect the project are tracked, with an exploitability justification, in the [VEX feed](/docs/VEX.md) rather than silently ignored.

## Deployment Security Guide

When deploying this application, please ensure you follow these security best practices:

### 1. Environment Variables

Never commit your `.env` file to version control. This file contains sensitive information such as database credentials and API keys.

Ensure you set the following environment variables in your production environment:

- **`JWT_SECRET`**: This is used to sign authentication tokens. Set a long, random string so sessions survive restarts (if unset, one is auto-generated and stored in the database instead — see [docs/SECRETS.md](../docs/SECRETS.md)).
- **`SQLITE_DB_PATH`**: Ensure the SQLite database file lives on a volume/path that isn't publicly accessible or served by the web server.
- **`IGDB_CLIENT_SECRET`**: Your IGDB API secret.

### 2. Docker Compose

Questarr uses SQLite, not PostgreSQL — the provided `docker-compose.yml` does not run a separate database container. Persist the `./data` volume (which holds `sqlite.db`) and never commit real credentials into `docker-compose.yml`; use a `.env` file or a git-ignored `docker-compose.*local.yml` override instead.

### 3. Network Security

- Run the application behind a reverse proxy (like Nginx or Traefik) with SSL/TLS enabled (HTTPS).
- `HOST` defaults to `0.0.0.0` (all network interfaces) in every deployment mode, not just Docker. Set `HOST=127.0.0.1` if the app should only be reachable through a local reverse proxy.

### 4. Authentication

- The application uses a default admin setup flow. Ensure you complete the setup immediately after deployment to claim the admin account.

## Collaborator Access & Escalation Policy

This policy governs how contributors are granted escalated permissions to this repository and its associated infrastructure. It is enforced by repository maintainers/admins for every access request — no escalation may be granted outside this process.

The current list of project members holding escalated access is maintained in [MAINTAINERS.md](/MAINTAINERS.md).

### Scope

"Escalated permissions" covers any of the following:

- Write, Maintain, or Admin roles on the GitHub repository
- Merge/approval rights on pull requests (including bypassing branch protection)
- Access to repository or organization **Secrets** (Actions secrets, environment secrets, deploy keys, `.env` values for shared/hosted environments)
- Access to production or staging infrastructure (hosting provider, database, CI/CD runners)
- Ability to modify CI/CD workflows, branch protection rules, or this policy itself

### Requirement: Review Before Grant

No contributor may be granted an escalated permission listed above without prior review and explicit approval by an existing repository admin/maintainer. This includes:

1. **Request & record** — The requested role/access and its justification are recorded (e.g., in an issue, PR, or admin log) before being granted, not after.
2. **Independent approval** — The grant must be approved by an admin/maintainer other than the requester. A contributor cannot self-approve their own escalation.
3. **Least privilege** — Grant the minimum role/access needed for the contributor's actual responsibilities (e.g., prefer Write over Maintain, avoid org-wide secrets access for repo-scoped work).
4. **Time-bound where practical** — Temporary or contract contributors should have access scoped to the duration of their engagement and reviewed/revoked on completion.

### Identity Vetting

Before approving escalated access, the approver should establish a justifiable lineage of identity for the contributor, using one or more of:

- Confirming the contributor's association with a known, trusted organization (verified work email domain, employer/organization GitHub membership, or a signed statement from a known point of contact at that organization)
- A documented history of reviewed, merged contributions from the same account prior to escalation
- Vouching by an existing trusted collaborator or maintainer who can attest to the contributor's identity
- Verification of a persistent, non-anonymous identity (e.g., a GitHub account with verifiable history, linked organization, or public reputation) rather than a newly created or anonymous account

Requests that cannot establish any of the above should be denied or downgraded to a lesser scope (e.g., fork-and-PR contribution without direct write access) until sufficient trust is established.

### Periodic Review & Revocation

- Maintainers should periodically review the list of collaborators with escalated access (`Settings > Collaborators and teams`) and remove access that is no longer needed.
- Access must be revoked promptly when a contributor's engagement ends, their role changes, or trust in their identity/affiliation is called into question.
- Any suspected compromise of a collaborator account or leaked secret must be treated as a security incident: revoke access immediately, rotate affected secrets, and follow the vulnerability reporting process above.
