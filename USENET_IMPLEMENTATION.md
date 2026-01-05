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
- [x] Update aggregated search to query both Torznab and Newznab indexers
- [x] Add protocol detection in search results
- [x] Update `/api/indexers/search` to support both protocols
- [x] Ensure downloader type validation (torrent downloaders for torrents, usenet for NZBs)

#### Storage Layer (`server/storage.ts`)
- [x] Update `gameDownloads` queries (currently using `gameTorrents`)
- [x] Add protocol filtering for indexer queries
- [x] Ensure backward compatibility during migration

#### Middleware (`server/middleware.ts`)
- [x] Update indexer validation to include protocol field
- [x] Add downloader type validation for SABnzbd/NZBGet

### Frontend (Phase 4)

#### Search Page (`client/src/pages/search.tsx`)
- [x] Add download type badges (Torrent/Usenet)
- [x] Show appropriate metrics:
  - Torrents: Seeders/Leechers
  - Usenet: Grabs/Age
- [x] Update result card styling to distinguish types
- [x] Filter compatible downloaders by protocol

#### Game Download Dialog (`client/src/components/GameDownloadDialog.tsx`)
- [x] Filter downloaders by compatible protocol
- [x] Adjust form fields based on download type:
  - Torrent: Priority, Category
  - Usenet: Priority (different values)
- [x] Update submit logic to use correct API endpoint

#### Downloads Page (`client/src/pages/downloads.tsx`)
- [x] Add download type badges
- [x] Show appropriate metrics per type:
  - Torrents: Speeds (up/down), Ratio, Seeders/Leechers
  - Usenet: Download speed only, Repair/Unpack status
- [x] Update status badges for new statuses (repairing, unpacking)
- [x] Add filter tabs: All / Torrents / Usenet

#### Indexers Page (`client/src/pages/indexers.tsx`)
- [x] Add protocol field to indexer form
- [x] Show protocol badge in indexer list (Torznab/Newznab)
- [x] Update test connection for Newznab
- [x] Add protocol icon/indicator

#### Downloaders Page (`client/src/pages/downloaders.tsx`)
- [x] Add SABnzbd and NZBGet to type dropdown
- [x] Update form fields based on downloader type:
  - SABnzbd: API URL, API Key
  - NZBGet: URL, Username, Password
- [x] Show downloader type badge/icon
- [x] Update test connection for Usenet clients

#### Download Utils (`client/src/lib/downloads-utils.ts`)
- [x] Add `getDownloadTypeBadgeVariant(type)`
- [x] Add `shouldShowSeedersLeechers(download)`
- [x] Add `shouldShowRepairStatus(download)`
- [x] Add `shouldShowGrabsAge(download)`
- [x] Add `formatDownloadType(type)`
- [x] Update status badge logic for new statuses

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
- [x] Test status monitoring for both clients
- [x] Test repair/unpack status tracking
- [ ] Verify backward compatibility with existing torrents

### Frontend
- [x] Test search results display for both types
- [x] Test adding Usenet indexer
- [x] Test adding SABnzbd/NZBGet downloader
- [x] Test downloading NZB from search
- [x] Test downloads page with mixed torrents/NZBs
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