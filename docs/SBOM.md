# Software Bill of Materials (SBOM)

Every published Docker image is built with a Software Bill of Materials (SBOM), auto-generated at build time with [Syft](https://github.com/anchore/syft). This lets you see exactly what's inside an image — every package, library, and version — and feed that data into vulnerability scanners or SBOM catalogs like Dependency-Track.

## Where to find it

- **Attached to the image:** the SBOM is pushed alongside the image as an attestation, so it travels with whichever tag or digest you pull.
- **As a downloadable file:** each [Deploy Web App workflow run](https://github.com/Doezer/Questarr/actions/workflows/deploy.yml) uploads the SBOM as an SPDX-JSON artifact you can download directly from the run summary.

## Inspecting the attached SBOM

Use `docker buildx imagetools inspect` to pull the SPDX JSON for a given image and tag:

```bash
docker buildx imagetools inspect ghcr.io/doezer/questarr:latest --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

This prints the full SPDX document, which you can redirect to a file or pipe into a tool like `jq` or a vulnerability scanner:

```bash
docker buildx imagetools inspect ghcr.io/doezer/questarr:latest --format '{{ json (index .SBOM "linux/amd64").SPDX }}' > sbom.spdx.json
```

## Exploitability of reported vulnerabilities

Scanning this SBOM (or the image directly) with a tool like Grype or Trivy
may surface CVEs that don't actually affect Questarr — e.g. an OS package in
the `node:22-alpine` base image that's present but never executed. Questarr
publishes exploitability assessments for exactly this scenario as an
[OpenVEX](https://github.com/openvex/spec) feed; see
[docs/VEX.md](VEX.md) for the format and
[`security/vex/questarr.openvex.json`](../security/vex/questarr.openvex.json)
for the feed itself. Pass it to Trivy with `--vex` to suppress findings
already assessed as not affecting the project.
