# Real-Debrid

Questarr can use [Real-Debrid](https://real-debrid.com/) as a torrent downloader. Real-Debrid
fetches the torrent on its servers; Questarr then copies the finished files to a local **staging
folder** and runs the normal import pipeline on them. A premium Real-Debrid account is required.

## Setup

1. **Downloaders → Add Downloader**, type **Real-Debrid**.
2. Set the **Staging Path**: a local folder (inside the container if you use Docker) with enough
   room for the files. Each torrent is copied into `<staging>/<torrent id>/`.
3. Save, then edit the downloader and press **Connect Real-Debrid**. Open the address shown, enter
   the code, and approve. Questarr stores the resulting tokens encrypted on the server; they never
   reach the browser.
4. Optional: instead of Connect, paste a private API token from
   [https://real-debrid.com/apitoken](https://real-debrid.com/apitoken) into the password field.

## How it behaves

- A torrent shows as downloading while Real-Debrid fetches it (first half of the progress bar),
  then while the files are copied locally (second half). It is reported as completed only once
  every file is on disk, so nothing is imported half-copied.
- Magnet links and `.torrent` URLs are both supported. All files of the torrent are selected.
- Pause and resume are not available (Real-Debrid has no such call).
- After a successful import with "auto delete" enabled, the torrent is removed from Real-Debrid and
  the staged copy is deleted. Otherwise the staged folder stays until you remove the download.
- Expired access tokens are refreshed automatically. If Real-Debrid rejects the credentials, use
  **Reconnect**.

## Direct-download links

Real-Debrid can also fetch file-hoster links, not only torrents. On a game, open the **Download** menu and choose **Add download links**:

- Paste the links, one per line or a whole post (forum text and BBCode are fine): Questarr keeps the http(s) links, drops the duplicates and the trailing punctuation.
- Or attach a DLC, CCF or RSDF container file.
- Up to 500 links per job. Real-Debrid fetches them, then Questarr copies the files to the staging folder and imports them like a torrent.

## Notes

- The staging folder must be reachable by the import pipeline like any download folder; no path
  mapping is needed when Questarr itself writes there.
- Inspired by the Real-Debrid support in QuestarrNG; this is an independent implementation.
