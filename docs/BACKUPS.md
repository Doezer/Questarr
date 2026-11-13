---
title: "Backups"
description: "Back up and restore your Questarr library and settings."
---

# Backups

**Backups** (under Activity) saves your library, settings and sign-in data to a `.zip` file and restores it later, on the same install or a new one. It works on SQLite and on Postgres.

## What a backup contains

- The database: every game, indexer, downloader, setting, history entry and user.
- `config.yaml` (HTTPS settings), when it exists.
- The journal screenshots, only if you turn on **Include journal screenshots** (they can be large).
- `manifest.json`: Questarr version, database engine, number of migrations applied, row counts and a SHA-256 checksum of every file.

Certificate and key files under `data/ssl/` are **not** included. A backup made with SQLite uses SQLite's online backup, so it is consistent even while Questarr is running. A Postgres backup is a logical export (one NDJSON file per table) taken in a single read-only snapshot, so no `pg_dump` is needed in the container.

## Where backups are stored

In `backups/` next to `config.yaml`: `/app/data/backups` in Docker, so they sit on the `data` volume and survive an update or a recreated container. Set `BACKUP_DIR` to use another folder. Files are named `questarr_backup_v<version>_<date>_<kind>.zip` and are readable only by the Questarr user.

A backup is as good as full access to Questarr: it holds password hashes and the sign-in and encryption secrets. Keep it private.

## Schedule and retention

Questarr checks hourly (task **Backup** in System Tasks) and creates a **scheduled** backup when the interval has elapsed. Defaults: every 7 days, kept 28 days. Set the interval to 0 to turn scheduled backups off. Only scheduled backups are deleted automatically, and the newest one is always kept. **Manual** backups and the **Before restore** copy are never pruned.

## Environment variables and secrets

The credential encryption key (`CREDENTIALS_ENCRYPTION_KEY`) and `JWT_SECRET` are stored in the database unless you set them in the environment. If you did, they are **not** in the backup: keep them, or restored indexer and downloader passwords cannot be decrypted. The page warns you when this applies. After a restore, existing sign-in sessions may be invalid and you sign in again.

## Restoring

Use **Restore** on a saved backup, or **Restore from file** to upload one (up to 1 GB, `BACKUP_UPLOAD_MAX_MB` changes the limit).

1. Questarr checks the archive: no unsafe paths or links, checksums match, the format and database engine match, the database passes an integrity check, and the backup is **not newer** than this version of Questarr. A backup from an older version is accepted and migrated on start.
2. It saves a **Before restore** backup of the current state.
3. The backup is staged, and Questarr exits to apply it on the next start. In Docker it exits and your restart policy brings it back; elsewhere you restart it yourself (`QUESTARR_RESTORE_RESTART=true` or `false` overrides the detection).
4. On start, before the database opens, the staged file replaces the database. The previous file stays as `sqlite.db.pre-restore` next to it. On Postgres the tables are replaced in one transaction after migrations; if it fails, nothing changes.

Restoring from SQLite to Postgres (or back) is not supported; use the [migration script](DATABASE.md) for that.

## Limits

- A backup you want to keep off the server must be downloaded: backups are not sent to cloud storage.
- There is no passphrase encryption of the archive yet.
- Any signed-in user can create and restore backups; Questarr has no admin role, and the setup creates a single user.
