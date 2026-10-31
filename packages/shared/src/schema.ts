import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// post_id は数字文字列。JavaScript の number にすると X の ID が丸まるので text にする。
export const posts = sqliteTable("posts", {
  post_id: text("post_id").primaryKey(),
  text: text("text").notNull(),
  author: text("author").notNull(),
  tweet_url: text("tweet_url").notNull(),
  first_url: text("first_url"),
  source_created_at: text("source_created_at"),
  received_at: text("received_at").notNull(),
  batch_id: text("batch_id"),
});

export const JOB_STATUSES = [
  "PROCESSING",
  "READY_TO_PUBLISH",
  "PUBLISHED",
  "ABANDONED",
  "SKIPPED",
] as const;

// ジョブ ID は JST 日付をキーとする。主キーが一意制約を兼ねる。
// markdown は READY_TO_PUBLISH の間だけ持ち、PUBLISHED と ABANDONED で NULL にする。
export const jobs = sqliteTable(
  "jobs",
  {
    job_id: text("job_id").primaryKey(),
    processed_date: text("processed_date").notNull(),
    post_count: integer("post_count").notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    next_attempt_at: text("next_attempt_at"),
    deadline_at: text("deadline_at"),
    markdown: text("markdown"),
    commit_sha: text("commit_sha"),
    finished_at: text("finished_at"),
    error_type: text("error_type"),
  },
  (t) => [
    check(
      "jobs_status_check",
      sql`${t.status} in ('PROCESSING', 'READY_TO_PUBLISH', 'PUBLISHED', 'ABANDONED', 'SKIPPED')`,
    ),
  ],
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
