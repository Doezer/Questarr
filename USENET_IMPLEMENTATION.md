# Usenet Support Implementation Status

## Completed ✅

### Backend (Phase 1 & 2)

#### Schema Changes (`shared/schema.ts`)
- ✅ Added `protocol` field to indexers table (torznab/newznab)
- ✅ Extended downloaders enum to include `sabnzbd` and `nzbget`
- ✅ Renamed `gameTorrents` to `gameDownloads` (with backward compatibility alias)
- ✅ Added `downloadType` field ('torrent' | 'usenet')
- ✅ Updated `DownloadStatus` interface with Usenet-specific fields:
  - `downloadType`: Identifies torrent vs usenet
  - `repairStatus`: Par2 repair status (good/repairing/failed)
  - `unpackStatus`: Extract status (unpacking/completed/failed)
  - `age`: Age in days for Usenet posts

#### Newznab Client (`server/newznab.ts`)
- ✅ Complete Newznab protocol implementation
- ✅ Search functionality with category filtering
- ✅ Multi-indexer parallel search
- ✅ Category discovery (caps endpoint)
- ✅ Connection testing
- ✅ Usenet-specific metadata parsing (grabs, age, poster, groups)

#### Usenet Downloaders (`server/downloaders.ts`)
- ✅ SABnzbd client implementation:
  - Queue management
  - History tracking
  - Repair/unpack status monitoring
  - NZB addition via URL
  - Pause/resume/remove operations
  - Free space reporting
- ✅ NZBGet client implementation:
  - JSON-RPC protocol support
  - Queue and history management
  - Post-processing status tracking
  - All standard operations
- ✅ Updated `DownloaderManager.createClient()` to support new clients

## Remaining Work 🚧

### Backend (Phase 3)

#### Routes Integration (`server/routes.ts`)
- [ ] Update aggregated search to query both Torznab and Newznab indexers
- [ ] Add protocol detection in search results
- [ ] Update `/api/indexers/search` to support both protocols
- [ ] Ensure downloader type validation (torrent downloaders for torrents, usenet for NZBs)

#### Storage Layer (`server/storage.ts`)
- [ ] Update `gameDownloads` queries (currently using `gameTorrents`)
- [ ] Add protocol filtering for indexer queries
- [ ] Ensure backward compatibility during migration

#### Middleware (`server/middleware.ts`)
- [ ] Update indexer validation to include protocol field
- [ ] Add downloader type validation for SABnzbd/NZBGet

### Frontend (Phase 4)

#### Search Page (`client/src/pages/search.tsx`)
- [ ] Add download type badges (Torrent/Usenet)
- [ ] Show appropriate metrics:
  - Torrents: Seeders/Leechers
  - Usenet: Grabs/Age
- [ ] Update result card styling to distinguish types
- [ ] Filter compatible downloaders by protocol

#### Game Download Dialog (`client/src/components/GameDownloadDialog.tsx`)
- [ ] Filter downloaders by compatible protocol
- [ ] Adjust form fields based on download type:
  - Torrent: Priority, Category
  - Usenet: Priority (different values)
- [ ] Update submit logic to use correct API endpoint

#### Downloads Page (`client/src/pages/downloads.tsx`)
- [ ] Add download type badges
- [ ] Show appropriate metrics per type:
  - Torrents: Speeds (up/down), Ratio, Seeders/Leechers
  - Usenet: Download speed only, Repair/Unpack status
- [ ] Update status badges for new statuses (repairing, unpacking)
- [ ] Add filter tabs: All / Torrents / Usenet

#### Indexers Page (`client/src/pages/indexers.tsx`)
- [ ] Add protocol field to indexer form
- [ ] Show protocol badge in indexer list (Torznab/Newznab)
- [ ] Update test connection for Newznab
- [ ] Add protocol icon/indicator

#### Downloaders Page (`client/src/pages/downloaders.tsx`)
- [ ] Add SABnzbd and NZBGet to type dropdown
- [ ] Update form fields based on downloader type:
  - SABnzbd: API URL, API Key
  - NZBGet: URL, Username, Password
- [ ] Show downloader type badge/icon
- [ ] Update test connection for Usenet clients

#### Download Utils (`client/src/lib/downloads-utils.ts`)
- [ ] Add `getDownloadTypeBadgeVariant(type)`
- [ ] Add `shouldShowSeedersLeechers(download)`
- [ ] Add `shouldShowRepairStatus(download)`
- [ ] Add `shouldShowGrabsAge(download)`
- [ ] Add `formatDownloadType(type)`
- [ ] Update status badge logic for new statuses

### Database Migration (Phase 5)
- [ ] Create migration script to add new columns with defaults
- [ ] Test migration on existing data
- [ ] Document rollback procedure

## Design Specifications

### UI Distinctions

| Element | Torrent | Usenet |
|---------|---------|--------|
| Badge Color | Blue (`default`) | Purple (`secondary`) |
| Icon | `Download` | `Newspaper` |
| Primary Metrics | Seeders/Leechers | Grabs/Age |
| Speed Display | Up + Down | Down only |
| Status Values | downloading, seeding, completed, paused, error | downloading, repairing, unpacking, completed, paused, error |
| Additional Info | Ratio | Repair/Unpack status |

### Component Examples

```tsx
// Download Type Badge
<Badge variant={download.downloadType === 'torrent' ? 'default' : 'secondary'}>
  {download.downloadType === 'torrent' ? (
    <><Download className="h-3 w-3" /> Torrent</>
  ) : (
    <><Newspaper className="h-3 w-3" /> Usenet</>
  )}
</Badge>

// Conditional Metrics
{download.downloadType === 'torrent' && (
  <>
    <Badge>{download.seeders}S/{download.leechers}L</Badge>
    <Badge>Ratio: {download.ratio?.toFixed(2)}</Badge>
  </>
)}

{download.downloadType === 'usenet' && (
  <>
    <Badge>{download.grabs} grabs</Badge>
    <Badge>{download.age}d old</Badge>
    {download.repairStatus && (
      <Badge variant={download.repairStatus === 'failed' ? 'destructive' : 'default'}>
        Repair: {download.repairStatus}
      </Badge>
    )}
  </>
)}
```

## Testing Checklist

### Backend
- [ ] Test Newznab search with real indexer
- [ ] Test SABnzbd connection and NZB addition
- [ ] Test NZBGet connection and NZB addition
- [ ] Test status monitoring for both clients
- [ ] Test repair/unpack status tracking
- [ ] Verify backward compatibility with existing torrents

### Frontend
- [ ] Test search results display for both types
- [ ] Test adding Usenet indexer
- [ ] Test adding SABnzbd/NZBGet downloader
- [ ] Test downloading NZB from search
- [ ] Test downloads page with mixed torrents/NZBs
- [ ] Test filtering and sorting
- [ ] Verify responsive design

## Migration Plan

1. **Deploy schema changes** with backward compatibility
2. **Run database migration** to add new columns
3. **Update backend routes** gradually
4. **Deploy frontend updates** with feature flag
5. **Test with real Usenet providers**
6. **Enable for all users** after validation

## Known Limitations

- Usenet downloads don't support seeding (upload speed)
- NZB file details less granular than torrents
- Repair status requires SABnzbd/NZBGet to report it
- Some Usenet indexers may have different category schemes

## Future Enhancements

- [ ] NZB file upload support (in addition to URL)
- [ ] Usenet completion notifications
- [ ] Usenet-specific search categories
- [ ] Provider retention checking
- [ ] Failed article tracking
- [ ] Automation rules per protocol type
