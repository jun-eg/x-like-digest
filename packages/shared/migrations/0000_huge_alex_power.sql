CREATE TABLE `jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`processed_date` text NOT NULL,
	`post_count` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`deadline_at` text,
	`markdown` text,
	`commit_sha` text,
	`finished_at` text,
	`error_type` text,
	CONSTRAINT "jobs_status_check" CHECK("jobs"."status" in ('PROCESSING', 'READY_TO_PUBLISH', 'PUBLISHED', 'ABANDONED', 'SKIPPED'))
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`post_id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`author` text NOT NULL,
	`tweet_url` text NOT NULL,
	`first_url` text,
	`source_created_at` text,
	`received_at` text NOT NULL,
	`batch_id` text
);
