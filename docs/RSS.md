# RSS feeds

Open **Discover → RSS** to find releases from RSS feeds and match them to IGDB
games. Questarr includes a FitGirl feed; use **Manage Feeds** to add custom feeds
or enable and disable existing ones.

Enabled feeds refresh shortly after Questarr starts and every hour. Choose
**Refresh Feeds** to fetch new releases immediately. Refreshing keeps your feed
configuration, and overlapping refresh requests share a run.

Choose a release to review its game match, or follow its article link to the
original source. Disabled feeds do not participate in refreshes.

## Direct-download feeds

Some feeds publish file-hoster links instead of torrents. In **Manage Feeds**, switch on
**Items carry file-hoster download links (send them to Real-Debrid)** for such a feed, or for
an existing one with the **Extract download links** toggle in the **Links** column.

- Questarr keeps the hoster links found in each item's content. Blog pages and hosts that
  Real-Debrid cannot unrestrict are dropped.
- An item with links that is matched to a game of your library gets a button that opens **Add
  download links** with the links filled in. Real-Debrid then fetches them and Questarr imports
  the files. See [Real-Debrid](REAL-DEBRID.md#direct-download-links).
- A Real-Debrid downloader must be set up.
