import { jobs, posts } from "@x-like-digest/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
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

class PublishError extends Error {
  override name = "PublishError";
}

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

function client(token: string, fetchFn: typeof fetch) {
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
        { headers },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new PublishError(`GET ${res.status}`);
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
        },
      );
      // 新規 201、更新 200（4-4 の 3）
      if (res.status !== 201 && res.status !== 200) {
        throw new PublishError(`PUT ${res.status}`);
      }
      return putSchema.parse(await res.json()).commit.sha;
    },
  };
}

// 5-16〜5-18。成功なら commit SHA（既に同じ内容があったときは null）を返し、
// 保存できなかったときは投げる。投げられたジョブは READY_TO_PUBLISH のまま残す
// （再試行の間隔と期限は作業 9）
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

  const commitSha = await gh.put(path, {
    message: `digest: ${jobId}`,
    content: toBase64(markdown),
    branch: BRANCH,
  });

  // 内容一致の確認（5-17）。PUT の応答ではなく取り直した値で比べる
  const stored = await gh.get(path);
  if (stored === null || stored.sha !== expected) {
    throw new PublishError("sha mismatch");
  }
  return commitSha;
}

// 5-20 の (b)。READY_TO_PUBLISH のジョブを保存する。
// `next_attempt_at` の判定は作業 9 で入れるので、今は発火ごとに全件を試す
export async function publishReady({
  db,
  token,
  now,
  fetchFn = fetch,
}: PublishDeps): Promise<void> {
  const gh = client(token, fetchFn);

  const ready = await db
    .select({ job_id: jobs.job_id, markdown: jobs.markdown })
    .from(jobs)
    .where(eq(jobs.status, "READY_TO_PUBLISH"));

  for (const { job_id, markdown } of ready) {
    if (markdown === null) continue;
    try {
      const commit_sha = await store(gh, job_id, markdown);
      await db
        .update(jobs)
        .set({
          status: "PUBLISHED",
          commit_sha,
          finished_at: now.toISOString(),
          markdown: null,
        })
        .where(
          and(eq(jobs.job_id, job_id), eq(jobs.status, "READY_TO_PUBLISH")),
        );
      log("batch_published", { job_id });
    } catch (e) {
      log("publish_failed", { job_id, error_type: errorType(e) });
    }
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
