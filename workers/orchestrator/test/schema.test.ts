import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { jobs, posts } from "@x-like-digest/shared";
import { beforeAll, expect, inject, it } from "vitest";
import { createDb } from "../src/db";

const db = createDb(env.DB);

const post = {
  post_id: "1234567890123456789",
  text: "t",
  author: "a",
  tweet_url: "https://x.com/a/status/1234567890123456789",
  received_at: "2026-10-31T00:00:00Z",
};

const job = {
  job_id: "2026-10-31",
  processed_date: "2026-10-31",
  post_count: 1,
  status: "PROCESSING",
} as const;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
});

it("posts.post_id の重複を拒む", async () => {
  await db.insert(posts).values(post);
  await expect(db.insert(posts).values(post)).rejects.toThrow();
});

it("jobs のジョブ ID の重複を拒む", async () => {
  await db.insert(jobs).values(job);
  await expect(db.insert(jobs).values(job)).rejects.toThrow();
});

it("存在しない状態名を拒む", async () => {
  const bad = { ...job, job_id: "2026-11-01", status: "DONE" };
  // @ts-expect-error 4-3 に無い状態名は型検査で止まる
  const insert = db.insert(jobs).values(bad);
  await expect(insert).rejects.toThrow();
});

it("存在しない列名は型検査で止まる", () => {
  // @ts-expect-error posts に created_at は無い（列は source_created_at）
  db.select({ x: posts.created_at }).from(posts);
});
