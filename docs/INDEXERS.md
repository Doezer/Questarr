# Indexers and Prowlarr

Open **Indexers** to add a Torznab, Newznab, or G4U indexer, or choose
**Sync from Prowlarr** to import indexers from your existing Prowlarr instance.

## Sync from Prowlarr

1. Enter the Prowlarr URL and API key.
2. Optionally choose a priority and categories to apply to the synced indexers.
3. Choose **Sync** and review the result.

Questarr remembers the last successful connection and defaults. The stored API
key is encrypted and shown as a mask; leave it unchanged to reuse it. Enter a
new key when changing the connection. Equivalent URL spellings, such as a
trailing slash or scheme-less HTTP URL, keep the saved key. Sync does not follow redirects; enter the server's
final base URL.

When Prowlarr sits behind a TLS proxy, search results can reflect an HTTP
download link on the configured hostname or its internal port. Questarr
normalizes recognized Prowlarr proxy links to the configured origin without
wrapping them twice; external tracker links still use Prowlarr's proxy.

Use HTTPS whenever possible. For a trusted LAN server using HTTP, explicitly
select **Allow insecure LAN connection** before syncing. Clearing this choice
revokes the saved permission and matching synced indexers' HTTP permission even
if the sync cannot proceed. When replacing a saved HTTP connection with HTTPS and clearing this choice,
Questarr also revokes matching indexers from the previous connection before
saving the replacement. Enter the new connection's API key when changing its
identity. If a request reports that its
API key was withheld, check the URL and this setting before trying again.

See [SECRETS.md](SECRETS.md) for credential handling and [API.md](API.md) for the
indexer API.

## Download and blacklist from Discover

Open a Discover game's details, choose **Download**, and select a release.
Downloading or choosing **Send to downloader** adds the game to your library as
**Wanted** before sending it; a game already in your library uses its existing
record. Configure a compatible [downloader](DOWNLOADERS_COMPATIBILITY.md) first.

**Blacklist release** also adds the game if needed, then hides that release from
its download search. Future searches use the library game's blacklist. This
applies to search results as well as Discover games.

## Manage release blacklists

Open **Settings → Discovery & Downloads → Release Blacklist**. Add terms to
hide matching release names across manual, automatic and AI-assisted searches;
matching is case-insensitive. Choose **Save Blacklist** to save term edits.

The same card lists specific **Blacklisted Releases**, grouped by game. Removing
one takes effect immediately, without saving the term list. If loading fails,
choose **Retry**; the error does not mean the blacklist is empty.

## Manage a Discover game

In game details, **Hide** removes the game from Discover. **Remove** is available
when the game is in your library and removes that record; from Discover it does
not delete game files or remove downloads from the client. A personal rating
uses the existing library record, or adds an untracked game as **Wanted** first.
Discover refreshes after these actions, including the **Hide owned** and
**Hide wanted** filters.
