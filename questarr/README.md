# Questarr Home Assistant Add-on

This add-on runs Questarr with persistent data stored in Home Assistant's `/data` volume.

## Notes

- Web UI: `http://<home-assistant-host>:5000`
- Database path: persisted in `/data/sqlite.db` (`/app/data` is symlinked to `/data`)
- Current add-on architecture support: `amd64` only
