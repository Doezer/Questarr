# Library Import

Questarr can import completed downloads into your library and discover games
already on disk. Configure download imports in **Settings → Import**; manage
existing directories in **Library → Library Import**.

## Configure download imports

Enable **Post-Processing**, choose a **Library Root**, and save your changes.
Questarr must be able to read the download source and write to the library root.
In Docker, mount both locations and use their paths inside the container.

| Setting                           | Behavior                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer Mode                     | Move removes the source as files transfer; Copy leaves it intact. Hardlink preserves the source for seeding and falls back to copying when unsupported. |
| Auto-Unpack Archives              | Extract ZIP, RAR, and 7z downloads for import. Password-protected archives require manual input.                                                        |
| Overwrite Existing Files          | Allow replacement of existing destination files. Keep disabled to protect existing files.                                                               |
| Auto-delete source after import   | After a successful copy or move import, remove the download from the client and delete source files.                                                    |
| Sort add-on files into subfolders | Organize detected DLC, updates, and extras in `dlc/`, `update/`, and `extra/` for directory imports.                                                    |
| Rename Pattern                    | Use `{Title}`, `{Region}`, `{Platform}`, and `{Year}` to name the destination.                                                                          |
| Platform Filter                   | Use **Settings → Platforms** to limit eligible platforms; an empty list allows all platforms.                                                           |

### Path mappings and security

If your downloader reports paths Questarr cannot access, open the **Path Mappings**
subtab. Map the downloader's remote path to the corresponding local path visible
to Questarr. For example, map `/downloads` to `/data/downloads` when those paths
refer to the same mounted files.

The **Security** subtab optionally enables VirusTotal hash checks and/or ClamAV
scanning before unpacking or transferring files. Configure each provider and use
its connection test. A detection quarantines the download and produces a Security
Alert instead of importing it. See [SECRETS.md](SECRETS.md) for archive limits and
credential handling.

## How completed downloads are imported

Questarr checks completed downloads, translates their paths, determines the
platform and destination, and imports the files using the configured transfer
mode. Enabled archive extraction runs as part of this process. Successful imports
link files to the game and mark it Owned; Playing, Shelved, and Completed statuses
are preserved. Wii U releases and games identified by IGDB as Wii U use the
`Wii U` platform folder when Questarr selects the import destination.

Archive extraction stages the contents before merging them into the destination.
When importing an update into an existing game folder, files supplied by the
archive replace same-named files; unrelated installed files and saves remain.
File/directory conflicts and symlinked destination directories require correction
before retrying. If an error reports an incomplete rollback or a retained
`.questarr-extract-*.bak` directory, inspect its original files and the reported
paths before retrying or deleting it.

If a path is missing, a platform cannot be resolved, extraction needs a password,
or an import fails, the download is held for review instead of being silently
marked imported.

## Manual review in the Library

The **Pending Manual Imports** panel in the Library lists downloads requiring
attention. Expand it when several items are collapsed, then use the action shown:

- **Review** opens the import dialog. Check the source, destination, contents,
  transfer mode, and unpack option, then choose **Confirm Import**. The dialog
  also offers Symlink as a manual transfer mode.
- **Enter Password** supplies the archive password before retrying extraction.
- **Link Game** attaches a download whose original game record is missing.
- **Skip** removes an item from the pending queue. Quarantined items offer
  **Dismiss** and cannot be imported from this panel.

Correct inaccessible paths or mounts before retrying a failed import. Reviewing
a downloaded file is separate from confirming an IGDB match for an existing
folder below.

## Import history

Open **Activity → Import History** to inspect Steam wishlist,
file-import, and Scan Unlinked tasks. The list shows the trigger, status, start
time, duration, and added/skipped/failed counts. Select a task to see individual
game results, fuzzy matches, and error messages. Running tasks update as they
progress.

Root-folder scan progress and unmatched candidates are shown on **Library Import**;
they are temporary scan state rather than a persistent Import History record.

## Discover games already on disk

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

### Scans and review

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
