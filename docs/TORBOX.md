# TorBox

Questarr can use [TorBox](https://torbox.app/) as a torrent downloader. TorBox fetches the torrent
on its servers; Questarr then copies the finished files to a local **staging folder** and runs the
normal import pipeline on them. It works the same way as [Real-Debrid](REAL-DEBRID.md) and shares
its staging code.

> **Not tested against a real account yet.** The calls follow TorBox's published OpenAPI
> document, but it does not describe the answers in detail (torrent fields, status values), so
> those parts were written defensively. Please report anything odd.

## Setup

1. Create an API key in your TorBox account settings.
2. **Downloaders → Add Downloader**, type **TorBox**.
3. Paste the key in **API key**. It is stored encrypted on the server and never sent back to the
   browser.
4. Set the **Staging Path**: a local folder (inside the container if you use Docker) with enough
   room for the files. Each torrent is copied into `<staging>/<torrent id>/`.
5. Press **Test connection**, then save.

## How it behaves

- A torrent shows as downloading while TorBox fetches it (first half of the progress bar), then
  while the files are copied locally (second half). It is reported as completed only once every
  file is on disk, so nothing is imported half-copied.
- Magnet links and `.torrent` URLs are both supported. If TorBox would only queue the torrent
  (active download limit), the add is reported as failed instead of waiting silently.
- Only torrents Questarr added are copied. Other torrents in your TorBox account are left alone.
- Pause and resume are not available.
- After a successful import with "auto delete" enabled, the torrent is removed from TorBox and the
  staged copy is deleted. Otherwise the staged folder stays until you remove the download.
- A failed copy is retried with a growing delay; after five attempts the download shows an error.
- Download links are requested file by file when the copy starts, so they never expire unused.

## Not included

- Usenet downloads through TorBox.
- A "link only" mode that skips the local copy (tracked separately).
