import { jobs, posts } from "@x-like-digest/shared";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { deadlineOf } from "./batch";
import type { createDb } from "./db";

type Db = ReturnType<typeof createDb>;

// 保存先は 9-6 の確定内容
const REPO = "jun-eg/my-bias";
const BRANCH = "main";

export type PublishDeps = {
  db: Db;
  token: string;
  now: Date;
  fetchFn?: typeof fetch;
};

// GitHub の応答は境界なので zod で確かめる（6-13）
const fileSchema = z.object({ sha: z.string().min(1) });
const putSchema = z.object({
  commit: z.object({ sha: z.string().min(1) }),
});

function log(event: string, fields: Record<string, string | number>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function errorType(e: unknown): string {
  return e instanceof Error ? e.name : "unknown";
}

// retry は次の回に回す失敗、fatal は 4-4 の 5 の即時に打ち切る応答（5-24）。
// retryAt は Retry-After が示す時刻（5-22）
class PublishError extends Error {
  override name = "PublishError";
  constructor(
    message: string,
    readonly kind: "retry" | "fatal" = "retry",
    readonly retryAt: Date | null = null,
  ) {
    super(message);
  }
}

function retryAfter(res: Response, now: Date): Date | null {
  const raw = res.headers.get("retry-after");
  if (raw === null) return null;
  if (/^\d+$/.test(raw)) return new Date(now.getTime() + Number(raw) * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : new Date(at);
}

// 4-4 の 4・5。403 はレート制限（残りが 0、または Retry-After 付き）だけ再試行する
function httpError(op: string, res: Response, now: Date): PublishError {
  const message = `${op} ${res.status}`;
  const retryAt = retryAfter(res, now);
  const limited =
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get("x-ratelimit-remaining") === "0" || retryAt !== null));
  if (limited) return new PublishError(message, "retry", retryAt);
  if ([401, 403, 404, 422].includes(res.status)) {
    return new PublishError(message, "fatal");
  }
  return new PublishError(message, "retry", retryAt);
}

const TIMEOUT_MS = 15_000;

// Git blob SHA-1: sha1("blob " + バイト長 + "\0" + 本文)（6-6）
export async function gitBlobSha(body: string): Promise<string> {
  const content = new TextEncoder().encode(body);
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const all = new Uint8Array(header.length + content.length);
  all.set(header, 0);
  all.set(content, header.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(body: string): string {
  let binary = "";
  for (const b of new TextEncoder().encode(body)) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function client(token: string, fetchFn: typeof fetch, now: Date) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "x-like-digest-orchestrator",
  };
  return {
    // ファイルが無ければ null
    async get(path: string): Promise<{ sha: string } | null> {
      const res = await fetchFn(
        `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
        { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw httpError("GET", res, now);
      return fileSchema.parse(await res.json());
    },
    async put(
      path: string,
      body: { message: string; content: string; branch: string; sha?: string },
    ): Promise<string> {
      const res = await fetchFn(
        `https://api.github.com/repos/${REPO}/contents/${path}`,
        {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      // 新規 201、更新 200（4-4 の 3）
      if (res.status !== 201 && res.status !== 200) {
        throw httpError("PUT", res, now);
      }
      return putSchema.parse(await res.json()).commit.sha;
    },
  };
}

// 5-16〜5-18。成功なら commit SHA（既に同じ内容があったときは null）を返し、
// 保存できなかったときは投げる。投げられたあとの扱いは attempt が決める
async function store(
  gh: ReturnType<typeof client>,
  jobId: string,
  markdown: string,
): Promise<string | null> {
  const path = `daily/${jobId}.md`;
  const expected = await gitBlobSha(markdown);

  const existing = await gh.get(path);
  if (existing !== null) {
    // 既存ファイルと内容が違えば競合。上書きしない（5-18、FR-07.8）
    if (existing.sha !== expected) throw new PublishError("conflict");
    return null;
  }

  let commitSha: string;
  try {
    commitSha = await gh.put(path, {
      message: `digest: ${jobId}`,
      content: toBase64(markdown),
      branch: BRANCH,
    });
  } catch (e) {
    // 応答が失われたときだけ、同じパスを GET して確かめる（3 節の境界値）。
    // HTTP の応答として返ってきた失敗は、その応答で分類する
    if (e instanceof PublishError) throw e;
    const found = await gh.get(path);
    if (found === null) throw new PublishError("lost response, no file");
    if (found.sha !== expected) throw new PublishError("conflict");
    return null;
  }

  // 内容一致の確認（5-17）。PUT の応答ではなく取り直した値で比べる
  const stored = await gh.get(path);
  if (stored === null || stored.sha !== expected) {
    throw new PublishError("sha mismatch");
  }
  return commitSha;
}

type Job = { job_id: string; markdown: string; deadline_at: string | null };

// 5-22。start は本処理の開始（deadline の 24 時間前）、attempts は今回の失敗を数えた値
export function nextAttemptAt(
  start: Date,
  deadline: Date,
  attempts: number,
  now: Date,
  retryAt: Date | null,
): Date {
  const base =
    attempts <= 6
      ? start.getTime() + attempts * 10 * 60 * 1000
      : now.getTime() + 60 * 60 * 1000;
  const next = Math.max(base, retryAt?.getTime() ?? 0);
  return new Date(Math.min(next, deadline.getTime()));
}

// 1 件を保存する。final は期限後の最終試行で、失敗なら ABANDONED にする（5-23）
async function attempt(
  db: Db,
  gh: ReturnType<typeof client>,
  job: Job,
  now: Date,
  final: boolean,
): Promise<void> {
  const { job_id } = job;
  try {
    const commit_sha = await store(gh, job_id, job.markdown);
    await db
      .update(jobs)
      .set({
        status: "PUBLISHED",
        commit_sha,
        finished_at: now.toISOString(),
        markdown: null,
      })
      .where(and(eq(jobs.job_id, job_id), eq(jobs.status, "READY_TO_PUBLISH")));
    log("batch_published", { job_id });
    return;
  } catch (e) {
    const error_type = e instanceof PublishError ? e.message : errorType(e);
    const fatal = e instanceof PublishError && e.kind === "fatal";
    log("publish_failed", { job_id, error_type });
    try {
      await settleFailure(db, job, now, final || fatal, error_type, e);
    } catch (e2) {
      // 記録に失敗したら READY_TO_PUBLISH のまま次の発火でやり直す
      log("settle_failed", { job_id, error_type: errorType(e2) });
    }
  }
}

async function settleFailure(
  db: Db,
  job: Job,
  now: Date,
  abandon: boolean,
  error_type: string,
  e: unknown,
): Promise<void> {
  const { job_id } = job;
  const current = (
    await db
      .select({ attempts: jobs.attempts })
      .from(jobs)
      .where(and(eq(jobs.job_id, job_id), eq(jobs.status, "READY_TO_PUBLISH")))
  )[0];
  if (current === undefined) return;
  const attempts = current.attempts + 1;

  if (abandon) {
    // 投稿と Markdown を捨てる（規則 6）。状態の変更と同じ batch で行う
    await db.batch([
      db
        .update(jobs)
        .set({
          status: "ABANDONED",
          attempts,
          markdown: null,
          error_type,
          finished_at: now.toISOString(),
          next_attempt_at: null,
        })
        .where(eq(jobs.job_id, job_id)),
      db.delete(posts).where(eq(posts.batch_id, job_id)),
    ]);
    log("batch_abandoned", { job_id, attempts, error_type });
    return;
  }

  const deadline = job.deadline_at
    ? new Date(job.deadline_at)
    : deadlineOf(job_id);
  const start = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
  const retryAt = e instanceof PublishError ? e.retryAt : null;
  const next = nextAttemptAt(start, deadline, attempts, now, retryAt);
  await db
    .update(jobs)
    .set({ attempts, next_attempt_at: next.toISOString(), error_type })
    .where(eq(jobs.job_id, job_id));
}

function usable(
  rows: {
    job_id: string;
    markdown: string | null;
    deadline_at: string | null;
  }[],
): Job[] {
  return rows.flatMap((r) =>
    r.markdown === null ? [] : [{ ...r, markdown: r.markdown }],
  );
}

const columns = {
  job_id: jobs.job_id,
  markdown: jobs.markdown,
  deadline_at: jobs.deadline_at,
};

// 5-23 の (a)。期限を過ぎた READY_TO_PUBLISH の最終試行を 1 回行い、失敗なら ABANDONED にする。
// 前日分が未保存のまま翌日の本処理に入る場合も、(c) の前にここで片付く
export async function settleExpired({
  db,
  token,
  now,
  fetchFn = fetch,
}: PublishDeps): Promise<void> {
  const gh = client(token, fetchFn, now);
  const expired = await db
    .select(columns)
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "READY_TO_PUBLISH"),
        isNotNull(jobs.deadline_at),
        lte(jobs.deadline_at, now.toISOString()),
      ),
    );
  for (const job of usable(expired)) {
    await attempt(db, gh, job, now, true);
  }
}

// 5-20 の (b)。next_attempt_at を過ぎた READY_TO_PUBLISH のジョブを保存する。
// 期限を過ぎたものは (a) の持ち分
export async function publishReady({
  db,
  token,
  now,
  fetchFn = fetch,
}: PublishDeps): Promise<void> {
  const gh = client(token, fetchFn, now);
  const at = now.toISOString();

  const due = await db
    .select(columns)
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "READY_TO_PUBLISH"),
        or(isNull(jobs.next_attempt_at), lte(jobs.next_attempt_at, at)),
        or(isNull(jobs.deadline_at), gt(jobs.deadline_at, at)),
      ),
    );

  for (const job of usable(due)) {
    await attempt(db, gh, job, now, false);
  }

  // PUBLISHED なのに投稿が残るジョブは、削除に失敗した跡。
  // 5-19 の削除は PUBLISHED にした後に行い、失敗したら次の発火で同じ batch_id をやり直す
  // 履歴が増えても束縛の数が増えないよう、PUBLISHED のジョブは副問い合わせで引く
  const left = await db
    .selectDistinct({ batch_id: posts.batch_id })
    .from(posts)
    .where(
      inArray(
        posts.batch_id,
        db
          .select({ job_id: jobs.job_id })
          .from(jobs)
          .where(eq(jobs.status, "PUBLISHED")),
      ),
    );
  for (const { batch_id } of left) {
    if (batch_id === null) continue;
    try {
      // バッチ外（別の batch_id と NULL）の投稿は消さない（規則 5）
      await db.delete(posts).where(eq(posts.batch_id, batch_id));
      log("batch_posts_deleted", { job_id: batch_id });
    } catch (e) {
      log("delete_failed", { job_id: batch_id, error_type: errorType(e) });
    }
  }
}
