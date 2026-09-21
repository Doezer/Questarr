// Download hashes arrive from several directions — the async add route, the
// claim/bundle routes, and cron's correlation-tag resolution — and each one
// used to trust whatever casing its source returned. BitTorrent info hashes are
// case-insensitive hex (v1: 40 chars, v2: 64 chars) and are stored under a
// unique index on (downloaderId, downloadHash), so two casings of the same hash
// produced two rows that never merged.
//
// Only hex torrent hashes are canonicalized. Correlation tags
// (`questarr-add-*`) and Usenet ids (SABnzbd `nzo_id`, NZBGet numeric ids) are
// opaque, case-sensitive strings that getDownloadStatus matches by exact
// equality, so they must be persisted verbatim.
const TORRENT_HASH_PATTERN = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/;

export function normalizeDownloadHash(downloadHash: string): string {
  return TORRENT_HASH_PATTERN.test(downloadHash) ? downloadHash.toLowerCase() : downloadHash;
}

// Tracked-download keys are `${downloaderId}:${downloadHash}`. downloaderId is a
// UUID (never contains ':'), so the hash is everything after the first colon.
// Normalizing only that part keeps case-sensitive Usenet ids intact while still
// canonicalizing torrent hashes.
export function normalizeTrackedKey(key: string): string {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex === -1) {
    return key;
  }
  const downloaderId = key.slice(0, separatorIndex);
  const downloadHash = key.slice(separatorIndex + 1);
  return `${downloaderId}:${normalizeDownloadHash(downloadHash)}`;
}
