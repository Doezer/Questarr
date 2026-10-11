# Indexers and Prowlarr

Open **Indexers** to add a Torznab, Newznab, or G4U indexer, or choose
**Sync from Prowlarr** to import indexers from your existing Prowlarr instance.

## Sync from Prowlarr

1. Enter the Prowlarr URL and API key.
2. Optionally choose a priority and categories to apply to the synced indexers.
3. Choose **Sync** and review the result.

Questarr remembers the last successful connection and defaults. The stored API
key is encrypted and shown as a mask; leave it unchanged to reuse it. Enter a
new key when changing the URL.

Use HTTPS whenever possible. For a trusted LAN server using HTTP, explicitly
select **Allow insecure LAN connection** before syncing. Clearing this choice
revokes permission to send credentials over HTTP. If a request reports that its
API key was withheld, check the URL and this setting before trying again.

See [SECRETS.md](SECRETS.md) for credential handling and [API.md](API.md) for the
indexer API.
