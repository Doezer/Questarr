# Library Import

Open **Library → Library Import** to discover games already on disk outside the
Library Root used for download imports. Add an existing readable directory with
**Add Folder**, optionally give it a label, and Questarr scans it automatically.
Use paths visible to the Questarr process; in Docker, mount the directory and
enter its container path, not the host path.

Games with a confident IGDB match are added as **Owned** and linked to their
existing files. Discovery does not move or rename those files. **Allow Delete**
is off by default: removing a game with its files skips files discovered under
that root unless you explicitly enable this permission. Removing a root-folder
configuration does not delete the directory itself.

## Scans and review

- Adding or enabling a root folder, or changing an enabled folder's path, starts
  a scan. Enabling post-processing in Settings → Import also scans enabled roots.
- **Scan** runs one enabled folder; **Scan All** runs all enabled folders.
  Changes to folder settings during an active scan queue a follow-up rescan.
- Progress shows queued/running/completed/failed status and matched, review, and
  error counts. Library and Discover refresh when matches are saved, including
  matches saved before a scan fails.
- Under **Needs Review**, choose a suggested IGDB game or enter a different
  name in **Not listed? Search IGDB by name**. Search alone does not import the
  game; clicking a candidate confirms it and adds it to your library.

If a folder is inaccessible, check the mount and the service user's permissions,
then use its health-recheck button. If IGDB search fails, the folder stays in
review so you can retry. Scan progress and unmatched candidates are in-memory
state; run another scan after a server restart to recreate them.

See [API.md](API.md#root-folders--library-scan) for scan and review endpoints and
[SECRETS.md](SECRETS.md) for filesystem and extraction limits.
