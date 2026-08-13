# TODO

## Multi-user hardening

Questarr is currently designed around a single admin-style user per instance. If multi-user support becomes a real deployment scenario, revisit:

- **`/api/system/browse` has no role/ownership gate** (`server/routes/system.ts`). It lets any authenticated user browse the entire container filesystem, which is fine for a single-admin deployment but becomes an authorization gap the moment multiple users are trusted at different privilege levels. Add an admin-role check (or otherwise restrict browsing to expected library/download directories) before enabling true multi-user access.
