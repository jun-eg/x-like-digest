import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { jobs, posts } from "@x-like-digest/shared";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, expect, inject, it, vi } from "vitest";
import { createDb } from "../src/db";
import worker from "../src/index";
import { gitBlobSha, publishReady } from "../src/publish";

const db = createDb(env.DB);

const DAY = "2026-11-03";
const NOW = new Date(`${DAY}T09:30:00.000Z`);
const MD = "# IT Daily Digest — 2026-11-03\n\n日本語の本文\n";

const post = (id: string, batch_id: string | null) => ({
  post_id: id,
  text: `本文 ${id}`,
  author: "alice",
  tweet_url: `https://x.com/alice/status/${id}`,
  received_at: `${DAY}T01:00:00.000Z`,
  batch_id,
});

const job = async (id = DAY) =>
  (await db.select().from(jobs).where(eq(jobs.job_id, id)))[0];

const ready = (id = DAY, markdown = MD) =>
  db.insert(jobs).values({
    job_id: id,
    processed_date: id,
    post_count: 1,
    status: "READY_TO_PUBLISH",
    markdown,
  });

type Call = { method: string; url: string; body: unknown; auth: string | null };

// GitHub Contents API の偽物。files はパス → Git blob SHA
function fakeGitHub(
  opts: {
    files?: Record<string, string>;
    putStatus?: number;
    // PUT のあとの GET が返す sha を差し替える
    sha_after_put?: (real: string) => string;
  } = {},
) {
  const files = { ...opts.files };
  const calls: Call[] = [];
  const fetchFn = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body, auth: headers.get("authorization") });
      const path = new URL(url).pathname.replace(
        "/repos/jun-eg/my-bias/contents/",
        "",
      );
      if (method === "PUT") {
        const bytes = Uint8Array.from(atob(body.content), (c) =>
          c.charCodeAt(0),
        );
        const text = new TextDecoder().decode(bytes);
        const real = await gitBlobSha(text);
        files[path] = opts.sha_after_put ? opts.sha_after_put(real) : real;
        const status = opts.putStatus ?? 201;
        return Response.json(
          status === 201 || status === 200
            ? { content: { sha: real }, commit: { sha: "commit-abc" } }
            : { message: "x" },
          { status },
        );
      }
      const sha = files[path];
      return sha === undefined
        ? Response.json({ message: "Not Found" }, { status: 404 })
        : Response.json({ sha });
    },
  );
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, files };
}

const run = (gh: { fetchFn: typeof fetch }) =>
  publishReady({ db, token: "tok", now: NOW, fetchFn: gh.fetchFn });

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
});

beforeEach(async () => {
  await db.delete(posts);
  await db.delete(jobs);
});

it("6-6: Git blob SHA-1 は git hash-object と一致する（バイト長で数える）", async () => {
  expect(await gitBlobSha("hello\n")).toBe(
    "ce013625030ba8dba906f756967f9e9ca394464a",
  );
  expect(await gitBlobSha("こんにちは\n")).toBe(
    "b01625111fe65030fd322e875eaa3d2fbdea83b7",
  );
});

it("5-16: PUT の Body にパス・Base64・ブランチがあり、新規なので SHA は無い", async () => {
  await ready();
  const gh = fakeGitHub();

  await run(gh);

  const put = gh.calls.find((c) => c.method === "PUT");
  expect(put?.url).toBe(
    "https://api.github.com/repos/jun-eg/my-bias/contents/daily/2026-11-03.md",
  );
  expect(put?.auth).toBe("Bearer tok");
  const body = put?.body as Record<string, unknown>;
  expect(
    new TextDecoder().decode(
      Uint8Array.from(atob(String(body.content)), (c) => c.charCodeAt(0)),
    ),
  ).toBe(MD);
  expect(body.branch).toBe("main");
  expect("sha" in body).toBe(false);
  expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
});

it("5-16: PUT が 200 でも成功として扱う", async () => {
  await ready();
  const gh = fakeGitHub({ putStatus: 200 });

  await run(gh);

  expect((await job())?.status).toBe("PUBLISHED");
});

it("5-16: PUT が 201 でも 200 でもなければ READY_TO_PUBLISH のまま残る", async () => {
  await ready();
  await db.insert(posts).values(post("1", DAY));
  const gh = fakeGitHub({ putStatus: 500 });

  await run(gh);

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  expect(row?.markdown).toBe(MD);
  expect(await db.select().from(posts)).toHaveLength(1);
});

it("5-17: 取り直した sha が一致して PUBLISHED になり、commit_sha と finished_at が入って Markdown が NULL になる", async () => {
  await ready();
  const gh = fakeGitHub();

  await run(gh);

  const row = await job();
  expect(row?.status).toBe("PUBLISHED");
  expect(row?.commit_sha).toBe("commit-abc");
  expect(row?.finished_at).toBe(NOW.toISOString());
  expect(row?.markdown).toBeNull();
  // PUT のあとに GET で取り直している
  expect(gh.calls.map((c) => c.method)).toEqual(["GET", "PUT", "GET"]);
});

it("5-17: GET の sha が違えば PUBLISHED にならず、投稿も消えない", async () => {
  await ready();
  await db.insert(posts).values(post("1", DAY));
  const gh = fakeGitHub({ sha_after_put: () => "0".repeat(40) });

  await run(gh);

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  expect(row?.markdown).toBe(MD);
  expect(row?.commit_sha).toBeNull();
  expect(await db.select().from(posts)).toHaveLength(1);
});

it("5-18: 内容が違う既存ファイルがあれば PUT を送らず、READY_TO_PUBLISH のまま残る", async () => {
  await ready();
  await db.insert(posts).values(post("1", DAY));
  const gh = fakeGitHub({
    files: { "daily/2026-11-03.md": await gitBlobSha("別の内容") },
  });

  await run(gh);

  expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  expect((await job())?.status).toBe("READY_TO_PUBLISH");
  expect(await db.select().from(posts)).toHaveLength(1);
});

it("5-18: 同じ内容の既存ファイルなら PUT を送らず保存済みとして PUBLISHED にする", async () => {
  await ready();
  await db.insert(posts).values(post("1", DAY));
  const gh = fakeGitHub({
    files: { "daily/2026-11-03.md": await gitBlobSha(MD) },
  });

  await run(gh);

  expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  const row = await job();
  expect(row?.status).toBe("PUBLISHED");
  expect(row?.markdown).toBeNull();
  expect(await db.select().from(posts)).toHaveLength(0);
});

it("5-19: PUBLISHED のあと、そのバッチの投稿だけが消え、別バッチと NULL が残る", async () => {
  await ready();
  await db
    .insert(posts)
    .values([
      post("1", DAY),
      post("2", DAY),
      post("3", "2026-11-02"),
      post("4", null),
    ]);
  const gh = fakeGitHub();

  await run(gh);

  expect((await job())?.status).toBe("PUBLISHED");
  const left = (await db.select().from(posts)).map((p) => p.post_id).sort();
  expect(left).toEqual(["3", "4"]);
});

it("5-19: 削除に失敗して PUBLISHED のまま投稿が残ったら、次の発火で同じ batch_id を消す", async () => {
  // 前回の発火で PUBLISHED にした直後に D1 の削除が落ちた状態
  await db.insert(jobs).values({
    job_id: DAY,
    processed_date: DAY,
    post_count: 2,
    status: "PUBLISHED",
    commit_sha: "commit-abc",
  });
  await db
    .insert(posts)
    .values([post("1", DAY), post("3", "2026-11-02"), post("4", null)]);
  const gh = fakeGitHub();

  await run(gh);

  expect(gh.calls).toHaveLength(0);
  const left = (await db.select().from(posts)).map((p) => p.post_id).sort();
  expect(left).toEqual(["3", "4"]);
  expect((await job())?.status).toBe("PUBLISHED");
});

it("5-20: 発火の (b) が保存を行い、GitHub に繋がらなくても (c) の本処理は走る", async () => {
  await ready("2026-11-02", MD);
  await db.insert(posts).values(post("1", null));
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("network down"));
  const summarize = vi.fn(async () => ({ markdown: "# digest" }));
  const ctx = createExecutionContext();
  const handler: ExportedHandler<Env> = worker;
  const testEnv: Env = {
    ...env,
    SUMMARIZER: { summarize } as unknown as Env["SUMMARIZER"],
  };

  await handler.scheduled?.(
    createScheduledController({ scheduledTime: NOW, cron: "*/10 * * * *" }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(fetchSpy).toHaveBeenCalled();
  // deadline_at が NULL でも期限は deadlineOf で決まり、翌日 09:00 UTC を過ぎているので (a) で捨てる
  expect((await job("2026-11-02"))?.status).toBe("ABANDONED");
  expect((await job(DAY))?.status).toBe("READY_TO_PUBLISH");
  expect(summarize).toHaveBeenCalledTimes(1);
  fetchSpy.mockRestore();
});
