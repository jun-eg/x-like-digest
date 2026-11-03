CREATE TABLE `ingest_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`halted_at` text,
	`halt_reason` text,
	`failing_since` text,
	`auth_failed_at` text,
	CONSTRAINT "ingest_state_single_row" CHECK("ingest_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `seen_likes` (
	`post_id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seen_likes_position_unique` ON `seen_likes` (`position`);