# Changelog

All notable changes to this project will be documented in this file.


## [1.0.4] - 2026-01-13

- Initial release of the changelog

### Added
- feat: added links to torrent on indexer if available
- feat: add indexer filtering to download items in GameDownloadDialog
- feat: add indexerName to DownloadItem interface
- feat: add auto sorting functionality for downloaders and indexers based on priority and enabled status
- Add contributors list and shorten readme


### Changed
- refactor: added new max width for download title, aligned tooltip with changes, added underlines on hover to links
- Dep updates
- Update downloader and indexer pages to sort by enabled status, then priority and update disabled style
- feat: update downloader input placeholder to reflect selected type
- Allow IGDB configuration during initial setup, removing the need to edit the .env or docker-compose file.
- Updated deployment workflow
- Improved URL parsing to fix some issues when using external indexers/downloaders
- Refactoring of migration runner for more reliability

### Fixed
- fix: added missing seperator to download modal #312

---

> This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).