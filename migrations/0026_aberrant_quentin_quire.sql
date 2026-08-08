ALTER TABLE `games` ADD `update_search_results_available` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `packs_search_results_available` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE games SET update_search_results_available = search_results_available;
