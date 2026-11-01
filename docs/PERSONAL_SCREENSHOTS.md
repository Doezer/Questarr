# Personal screenshots

Open a saved game's details and jump to **Media → Your screenshots → Upload** to keep a memorable moment alongside its trailers and IGDB artwork. Choose one JPEG, PNG, or WebP image, up to 8 MB. A game can be saved with any library status, including Wanted; discovery results must be added first.

Click a thumbnail to view the full image. **Delete** removes that personal image. Uploads persist across reloads and remain separate from IGDB screenshots, so refreshing game metadata does not replace them. Existing journal uploads automatically appear here; there is no migration or duplicate upload required.

Images live on your Questarr server in the persistent data directory. Back it up with your database. The existing authenticated screenshot API checks game ownership, file size, MIME type, and image signatures; this change adds no new endpoint or external image service.

## Why this increment

Research reviewed on 2026-11-01:

- [Issue #1287](https://github.com/Doezer/Questarr/issues/1287) asks to upload personal photos in a game's gallery. The existing Journal already supported image storage, but Media only showed catalog artwork. Moving the controls to Media closes that discoverability gap and gives the collection a personal, playful element without another integration.
- [Current product scope](PRD.md) includes journals and screenshots. Reusing that storage preserves existing photos and avoids a competing gallery system.
- [Playnite](https://github.com/JosefNemec/Playnite) emphasizes a unified desktop library; [Gameyfin](https://github.com/gameyfin/gameyfin) emphasizes folder-based browser hosting; [ROMarr](https://github.com/BlizzHacker/romarr) emphasizes ROM acquisition and verification. Personal media is a useful fit for Questarr, rather than a claim of exclusive competitive advantage.

The stronger potential differentiator remains a server-native owned-library workflow: finish the [bulk Steam import PR #1273](https://github.com/Doezer/Questarr/pull/1273), rather than starting another overlapping integration. Compared with Playnite's Windows requirement and the folder/ROM focus of the other projects, importing an existing Steam collection into Questarr's self-hosted backlog and acquisition workflow reduces setup effort without a running desktop agent. Steam import alone is not unique; the combined server workflow is the opportunity. It still depends on Steam library visibility and IGDB mapping, and is not a launcher or cross-store sync service.
