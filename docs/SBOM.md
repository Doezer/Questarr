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
