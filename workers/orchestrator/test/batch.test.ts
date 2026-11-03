import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { jobs, posts, type SummarizeInput } from "@x-like-digest/shared";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, expect, inject, it, vi } from "vitest";
import { runDailyBatch, type Summarizer } from "../src/batch";
import { createDb } from "../src/db";
import worker from "../src/index";

const db = createDb(env.DB);

const DAY = "2026-11-03";
const at = (hhmmss: string) => new Date(`${DAY}T${hhmmss}.000Z`);

const post = (id: string, received_at: string) => ({
  post_id: id,
  text: `本文 ${id}`,
  author: "alice",
  tweet_url: `https://x.com/alice/status/${id}`,
  received_at,
});

function fakeSummarizer(
  impl: (
    input: SummarizeInput,
  ) => Promise<{ markdown: string }> = async () => ({
    markdown: "# digest",
  }),
) {
  const summarize = vi.fn(impl);
  const summarizer: Summarizer = { summarize };
  return { summarize, summarizer };
}

const job = async (id = DAY) =>
  (await db.select().from(jobs).where(eq(jobs.job_id, id)))[0];

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
});

beforeEach(async () => {
  await db.delete(posts);
  await db.delete(jobs);
});

it("5-8: received_at が 09:00 UTC 以前の投稿だけにバッチが付く", async () => {
  await db
    .insert(posts)
    .values([
      post("1", `${DAY}T08:59:59.999Z`),
      post("2", `${DAY}T09:00:00.000Z`),
      post("3", `${DAY}T09:00:00.001Z`),
    ]);
  const { summarize, summarizer } = fakeSummarizer();

  await runDailyBatch({ db, summarizer, now: at("09:05:00") });

  const rows = await db.select().from(posts);
  const batched = rows.filter((r) => r.batch_id === DAY).map((r) => r.post_id);
  expect(batched.sort()).toEqual(["1", "2"]);
  expect(rows.find((r) => r.post_id === "3")?.batch_id).toBeNull();
  const input = summarize.mock.calls[0]?.[0];
  expect(input?.digestDate).toBe(DAY);
  expect(input?.posts.map((p) => p.post_id).sort()).toEqual(["1", "2"]);
});

it("5-8: 実行が遅れても範囲は 09:00 UTC で切る", async () => {
  await db.insert(posts).values(post("1", `${DAY}T10:00:00.000Z`));
  const { summarizer } = fakeSummarizer();

  await runDailyBatch({ db, summarizer, now: at("12:00:00") });

  expect((await db.select().from(posts))[0]?.batch_id).toBeNull();
  expect((await job())?.status).toBe("SKIPPED");
});

it("5-10: 同じ日付の本処理を 2 回走らせても、ジョブは 1 件で要約は 1 回", async () => {
  await db.insert(posts).values(post("1", `${DAY}T01:00:00.000Z`));
  const { summarize, summarizer } = fakeSummarizer();

  await runDailyBatch({ db, summarizer, now: at("09:00:00") });
  await db.insert(posts).values(post("2", `${DAY}T02:00:00.000Z`));
  await runDailyBatch({ db, summarizer, now: at("09:10:00") });

  expect(await db.select().from(jobs)).toHaveLength(1);
  expect(summarize).toHaveBeenCalledTimes(1);
  const second = (await db.select().from(posts)).find((p) => p.post_id === "2");
  expect(second?.batch_id).toBeNull();
});

it("5-20: 09:00 UTC より前は何もしない", async () => {
  await db.insert(posts).values(post("1", `${DAY}T01:00:00.000Z`));
  const { summarize, summarizer } = fakeSummarizer();

  await runDailyBatch({ db, summarizer, now: at("08:59:59") });

  expect(await db.select().from(jobs)).toHaveLength(0);
  expect(summarize).not.toHaveBeenCalled();
});

it("5-9: 0 件なら SKIPPED で、Worker C を呼ばない", async () => {
  const { summarize, summarizer } = fakeSummarizer();
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  await runDailyBatch({ db, summarizer, now: at("09:05:00") });

  const row = await job();
  expect(row?.status).toBe("SKIPPED");
  expect(row?.markdown).toBeNull();
  expect(row?.post_count).toBe(0);
  expect(summarize).toHaveBeenCalledTimes(0);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

class SummarizeError extends Error {
  override name = "SummarizeError";
}

const failures: [string, () => Promise<never>][] = [
  ["Claude の失敗", () => Promise.reject(new Error("claude down"))],
  ["応答不正", () => Promise.reject(new SummarizeError("invalid response"))],
  [
    "不合格・入力上限超過",
    () => Promise.reject(new SummarizeError("validation failed")),
  ],
];

for (const [label, fail] of failures) {
  it(`5-14: ${label}で ABANDONED になり、投稿が 0 件で GitHub を呼ばない`, async () => {
    await db
      .insert(posts)
      .values([
        post("1", `${DAY}T01:00:00.000Z`),
        post("2", `${DAY}T09:30:00.000Z`),
      ]);
    const { summarizer } = fakeSummarizer(fail);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await runDailyBatch({ db, summarizer, now: at("09:05:00") });

    const row = await job();
    expect(row?.status).toBe("ABANDONED");
    expect(row?.markdown).toBeNull();
    expect(row?.post_count).toBe(1);
    expect(row?.error_type).not.toBeNull();
    // バッチの投稿だけが消え、バッチに属さない投稿は残る
    const left = await db.select().from(posts);
    expect(left.map((p) => p.post_id)).toEqual(["2"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
}

it("5-15: 合格した Markdown は READY_TO_PUBLISH の行にだけ入る", async () => {
  await db.insert(posts).values(post("1", `${DAY}T01:00:00.000Z`));
  const { summarizer } = fakeSummarizer(async () => ({ markdown: "# 本文" }));

  await runDailyBatch({ db, summarizer, now: at("09:05:00") });

  const ready = await job();
  expect(ready?.status).toBe("READY_TO_PUBLISH");
  expect(ready?.markdown).toBe("# 本文");
  expect(ready?.post_count).toBe(1);
  // 保存はまだ行わないので、投稿は残る
  expect(await db.select().from(posts)).toHaveLength(1);
});

it("5-20: 09:05 UTC の発火から本処理が走り、ジョブが 1 件で READY_TO_PUBLISH になる", async () => {
  await db.insert(posts).values(post("1", `${DAY}T01:00:00.000Z`));
  const { summarize, summarizer } = fakeSummarizer();
  const ctx = createExecutionContext();
  const handler: ExportedHandler<Env> = worker;
  const testEnv: Env = { ...env, SUMMARIZER: summarizer as Env["SUMMARIZER"] };

  const controller = createScheduledController({
    scheduledTime: at("09:05:00"),
    cron: "*/10 * * * *",
  });
  await handler.scheduled?.(controller, testEnv, ctx);
  await waitOnExecutionContext(ctx);

  const rows = await db.select().from(jobs);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("READY_TO_PUBLISH");
  expect(summarize).toHaveBeenCalledTimes(1);
});

it("JST で翌日になった 15:05 UTC の発火は、前日分を確定しない", async () => {
  await db.insert(posts).values(post("1", `${DAY}T01:00:00.000Z`));
  const { summarize, summarizer } = fakeSummarizer();

  await runDailyBatch({ db, summarizer, now: at("15:05:00") });

  expect(await db.select().from(jobs)).toHaveLength(0);
  expect((await db.select().from(posts))[0]?.batch_id).toBeNull();
  expect(summarize).not.toHaveBeenCalled();
});

it("当日のジョブがあれば、15:05 UTC の発火でもジョブは増えない", async () => {
  await db.insert(posts).values(post("1", `${DAY}T01:00:00.000Z`));
  const { summarize, summarizer } = fakeSummarizer();

  await runDailyBatch({ db, summarizer, now: at("09:05:00") });
  await runDailyBatch({ db, summarizer, now: at("15:05:00") });

  expect(await db.select().from(jobs)).toHaveLength(1);
  expect(summarize).toHaveBeenCalledTimes(1);
});
