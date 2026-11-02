-- Existing games keep game_modes NULL until their IGDB metadata is refreshed (Settings > Refresh Metadata); new adds and refreshes fill it.
ALTER TABLE games ADD COLUMN game_modes text;
