import { jobs, posts, type SummarizeInput } from "@x-like-digest/shared";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { createDb } from "./db";

type Db = ReturnType<typeof createDb>;

export type Summarizer = {
  summarize(input: SummarizeInput): Promise<{ markdown: string }>;
};

export type BatchDeps = {
  db: Db;
  summarizer: Summarizer;
  now: Date;
};

// 内部は UTC だが、ジョブ ID は JST の日付（2 節、3 節の規則 3）。
// 境界はその JST 日付の 18:00 JST = 09:00 UTC で作る。UTC の日付から作ると、
// 15:00 UTC 以降（JST では翌日）の発火が、まだ来ていない翌日の境界を飛ばして前日分を確定してしまう
export function batchBoundary(now: Date) {
  const jobId = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const cutoff = new Date(`${jobId}T09:00:00.000Z`);
  return { jobId, cutoff };
}

// 保存の期限は翌日 09:00:00 UTC（5-23）
export function deadlineOf(jobId: string): Date {
  return new Date(
    new Date(`${jobId}T09:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
  );
}

function log(event: string, fields: Record<string, string | number>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function errorType(e: unknown): string {
  return e instanceof Error ? e.name : "unknown";
}

// 5-20 の (c)。当日のジョブが無く 09:00 UTC 以降なら本処理を行う。
// 「当日のジョブが無い」はジョブ ID の一意制約で見る（5-10）
export async function runDailyBatch({
  db,
  summarizer,
  now,
}: BatchDeps): Promise<void> {
  const { jobId, cutoff } = batchBoundary(now);
  if (now < cutoff) return;

  const inserted = await db
    .insert(jobs)
    .values({
      job_id: jobId,
      processed_date: jobId,
      post_count: 0,
      status: "PROCESSING",
      attempts: 0,
      next_attempt_at: now.toISOString(),
      deadline_at: deadlineOf(jobId).toISOString(),
    })
    .onConflictDoNothing()
    .returning({ job_id: jobs.job_id });
  if (inserted.length === 0) return;

  // 確定は 1 文（5-8）。範囲は実行時刻ではなく 09:00 UTC で切る
  const confirmed = await db
    .update(posts)
    .set({ batch_id: jobId })
    .where(
      and(isNull(posts.batch_id), lte(posts.received_at, cutoff.toISOString())),
    )
    .returning({ post_id: posts.post_id });
  const count = confirmed.length;

  if (count === 0) {
    await db
      .update(jobs)
      .set({ status: "SKIPPED", finished_at: now.toISOString() })
      .where(eq(jobs.job_id, jobId));
    log("batch_skipped", { job_id: jobId, post_count: 0 });
    return;
  }

  const batch = await db
    .select({
      post_id: posts.post_id,
      text: posts.text,
      author: posts.author,
      tweet_url: posts.tweet_url,
    })
    .from(posts)
    .where(eq(posts.batch_id, jobId));

  try {
    const { markdown } = await summarizer.summarize({
      posts: batch,
      digestDate: jobId,
    });
    await db
      .update(jobs)
      .set({ status: "READY_TO_PUBLISH", post_count: count, markdown })
      .where(eq(jobs.job_id, jobId));
    log("batch_ready", { job_id: jobId, post_count: count });
  } catch (e) {
    // 要約は 1 回だけ。失敗したらバッチの投稿を捨てる（5-14）
    const error_type = errorType(e);
    await db.batch([
      db
        .update(jobs)
        .set({
          status: "ABANDONED",
          post_count: count,
          markdown: null,
          error_type,
          finished_at: now.toISOString(),
        })
        .where(eq(jobs.job_id, jobId)),
      db.delete(posts).where(eq(posts.batch_id, jobId)),
    ]);
    log("batch_abandoned", { job_id: jobId, post_count: count, error_type });
  }
}
