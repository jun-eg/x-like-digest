CREATE TABLE `x_auth` (
	`id` integer PRIMARY KEY NOT NULL,
	`refresh_token` text NOT NULL,
	`seed_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "x_auth_single_row" CHECK("x_auth"."id" = 1)
);
