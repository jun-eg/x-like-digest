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
import { runDailyBatch } from "../src/batch";
import { createDb } from "../src/db";
import worker from "../src/index";
import { gitBlobSha, publishReady, settleExpired } from "../src/publish";

const db = createDb(env.DB);

const DAY = "2026-11-03";
const NEXT = "2026-11-04";
const MD = "# IT Daily Digest — 2026-11-03\n\n本文\n";
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000Z`);
// 本処理の開始は 18:00 JST = 09:00 UTC
const START = at(DAY, "09:00");
const DEADLINE = "2026-11-04T09:00:00.000Z";

const job = async (id = DAY) =>
  (await db.select().from(jobs).where(eq(jobs.job_id, id)))[0];

const ready = (id = DAY, markdown = MD) => {
  const start = new Date(`${id}T09:00:00.000Z`);
  return db.insert(jobs).values({
    job_id: id,
    processed_date: id,
    post_count: 1,
    status: "READY_TO_PUBLISH",
    markdown,
    attempts: 0,
    next_attempt_at: start.toISOString(),
    deadline_at: new Date(start.getTime() + 24 * 3600 * 1000).toISOString(),
  });
};

const post = (id: string, batch_id: string | null) => ({
  post_id: id,
  text: `本文 ${id}`,
  author: "alice",
  tweet_url: `https://x.com/alice/status/${id}`,
  received_at: `${DAY}T01:00:00.000Z`,
  batch_id,
});

type Req = { method: string; body: unknown };
type Handler = (req: Req, n: number) => Response | Promise<Response>;

// GitHub の偽物。GET と PUT の呼び出しごとの応答を handler で決める
function fakeGitHub(handler: Handler) {
  const calls: Req[] = [];
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const req: Req = {
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(req);
    return handler(req, calls.length);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });
const status = (code: number, headers?: Record<string, string>) =>
  Response.json({ message: "x" }, { status: code, headers });
// PUT は失敗、GET はファイル無し
const putFails = (code: number, headers?: Record<string, string>) =>
  fakeGitHub((req) =>
    req.method === "PUT" ? status(code, headers) : notFound(),
  );

const run = (gh: { fetchFn: typeof fetch }, now: Date) =>
  publishReady({ db, token: "tok", now, fetchFn: gh.fetchFn });

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
});

beforeEach(async () => {
  await db.delete(posts);
  await db.delete(jobs);
});

it("5-21: 本処理の開始時に attempts・next_attempt_at・deadline_at が入る", async () => {
  await db.insert(posts).values(post("1", null));
  const summarize = vi.fn(async () => ({ markdown: MD }));

  await runDailyBatch({
    db,
    summarizer: { summarize },
    now: at(DAY, "09:05"),
  });

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  expect(row?.attempts).toBe(0);
  expect(row?.next_attempt_at).toBe("2026-11-03T09:05:00.000Z");
  expect(row?.deadline_at).toBe(DEADLINE);
});

it("5-21・5-22: 18:00 開始の失敗列で next_attempt_at が 18:10〜19:00、20:00、21:00 JST になり、attempts が 1 ずつ増える", async () => {
  await ready();
  const gh = putFails(500);
  const fires = [
    "09:00", // 18:00 JST
    "09:10",
    "09:20",
    "09:30",
    "09:40",
    "09:50",
    "10:00", // 7 回目
    "11:00",
  ];
  const next: string[] = [];
  const attempts: number[] = [];
  for (const hhmm of fires) {
    await run(gh, at(DAY, hhmm));
    const row = await job();
    next.push(row?.next_attempt_at?.slice(11, 16) ?? "");
    attempts.push(row?.attempts ?? -1);
  }
  // 18:10, 18:20, 18:30, 18:40, 18:50, 19:00 JST, 20:00, 21:00 JST
  expect(next).toEqual([
    "09:10",
    "09:20",
    "09:30",
    "09:40",
    "09:50",
    "10:00",
    "11:00",
    "12:00",
  ]);
  expect(attempts).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect((await job())?.status).toBe("READY_TO_PUBLISH");
});

it("5-20: next_attempt_at より前の発火では保存を試さない", async () => {
  await ready();
  const gh = putFails(500);
  await run(gh, at(DAY, "09:00"));
  const before = gh.calls.length;

  await run(gh, at(DAY, "09:05"));

  expect(gh.calls).toHaveLength(before);
  expect((await job())?.attempts).toBe(1);
});

it("5-12: 保存を 3 回失敗させても要約の呼び出しは 1 回", async () => {
  await db.insert(posts).values(post("1", null));
  const summarize = vi.fn(async () => ({ markdown: MD }));
  const summarizer = { summarize };
  const gh = putFails(500);

  await runDailyBatch({ db, summarizer, now: at(DAY, "09:00") });
  for (const hhmm of ["09:10", "09:20", "09:30"]) {
    const now = at(DAY, hhmm);
    await run(gh, now);
    await runDailyBatch({ db, summarizer, now });
  }

  expect((await job())?.attempts).toBe(3);
  expect(summarize).toHaveBeenCalledTimes(1);
});

it("5-23: 期限後の発火で最終試行が失敗すると ABANDONED になり、投稿と Markdown が消える（バッチ外は残る）", async () => {
  await ready();
  await db
    .insert(posts)
    .values([post("1", DAY), post("2", DAY), post("3", NEXT), post("4", null)]);
  const gh = putFails(500);

  await settleExpired({
    db,
    token: "tok",
    now: new Date(DEADLINE),
    fetchFn: gh.fetchFn,
  });

  const row = await job();
  expect(row?.status).toBe("ABANDONED");
  expect(row?.markdown).toBeNull();
  expect(row?.attempts).toBe(1);
  expect(row?.finished_at).toBe(DEADLINE);
  expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  const left = (await db.select().from(posts)).map((p) => p.post_id).sort();
  expect(left).toEqual(["3", "4"]);
});

it("5-23: 最終試行が成功すれば PUBLISHED になる", async () => {
  await ready();
  const gh = fakeGitHub((req) =>
    req.method === "PUT"
      ? Response.json({ content: {}, commit: { sha: "c1" } }, { status: 201 })
      : notFound(),
  );
  // PUT のあとの GET は保存済みの sha を返す
  const sha = await gitBlobSha(MD);
  let put = false;
  const fetchFn = (async (i: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") put = true;
    if (put && (init?.method ?? "GET") === "GET") return Response.json({ sha });
    return gh.fetchFn(i, init);
  }) as typeof fetch;

  await settleExpired({ db, token: "tok", now: new Date(DEADLINE), fetchFn });

  expect((await job())?.status).toBe("PUBLISHED");
});

it("5-23: (b) は期限を過ぎたジョブを試さず、期限前のジョブだけ試す", async () => {
  await ready();
  const gh = putFails(500);

  await run(gh, new Date(DEADLINE));

  expect(gh.calls).toHaveLength(0);
  expect((await job())?.status).toBe("READY_TO_PUBLISH");
});

it("5-23: 前日分が未保存のまま翌日の本処理に入ると、前日分を先に捨て、当日分は混ざらない", async () => {
  await ready("2026-11-02", "# 前日");
  await db.insert(posts).values([post("1", "2026-11-02"), post("2", null)]);
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_i, init) =>
      init?.method === "PUT" ? status(500) : notFound(),
    );
  const summarize = vi.fn(async () => ({ markdown: MD }));
  const ctx = createExecutionContext();
  const handler: ExportedHandler<Env> = worker;
  const testEnv: Env = {
    ...env,
    SUMMARIZER: { summarize } as unknown as Env["SUMMARIZER"],
  };

  await handler.scheduled?.(
    createScheduledController({
      scheduledTime: at(DAY, "09:00"),
      cron: "*/10 * * * *",
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  fetchSpy.mockRestore();

  expect((await job("2026-11-02"))?.status).toBe("ABANDONED");
  expect((await job(DAY))?.status).toBe("READY_TO_PUBLISH");
  const batches = (await db.select().from(posts)).map((p) => p.batch_id);
  expect(batches).toEqual([DAY]);
  expect(summarize).toHaveBeenCalledTimes(1);
});

it.each([
  [401, undefined],
  [422, undefined],
  [404, undefined],
  [403, undefined],
])(
  "5-24: PUT が %i なら再試行せず ABANDONED で、attempts が 1",
  async (code, headers) => {
    await ready();
    await db.insert(posts).values(post("1", DAY));
    const gh = putFails(code, headers);

    await run(gh, START);

    const row = await job();
    expect(row?.status).toBe("ABANDONED");
    expect(row?.attempts).toBe(1);
    expect(row?.markdown).toBeNull();
    expect(row?.error_type).toBe(`PUT ${code}`);
    expect(await db.select().from(posts)).toHaveLength(0);
    // 次の発火でも何も呼ばない
    await run(gh, at(DAY, "09:10"));
    expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  },
);

it("5-24: GET が 401 でも即時に ABANDONED にする", async () => {
  await ready();
  const gh = fakeGitHub(() => status(401));

  await run(gh, START);

  const row = await job();
  expect(row?.status).toBe("ABANDONED");
  expect(row?.attempts).toBe(1);
});

it("5-24: レート制限の 403 は再試行する（残りが 0、または Retry-After 付き）", async () => {
  await ready();
  const gh = putFails(403, { "x-ratelimit-remaining": "0" });

  await run(gh, START);

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  expect(row?.attempts).toBe(1);

  const gh2 = putFails(403, { "retry-after": "60" });
  await run(gh2, at(DAY, "09:10"));
  expect((await job())?.status).toBe("READY_TO_PUBLISH");
  expect((await job())?.attempts).toBe(2);
});

it("5-22: 429 の Retry-After が式より遅ければそれに従う", async () => {
  await ready();
  const gh = putFails(429, { "retry-after": "7200" });

  await run(gh, START);

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  // 式は 09:10。Retry-After は 2 時間後の 11:00
  expect(row?.next_attempt_at).toBe("2026-11-03T11:00:00.000Z");
});

it("5-22: 429 の Retry-After が式より早ければ式に従う", async () => {
  await ready();
  const gh = putFails(429, { "retry-after": "30" });

  await run(gh, START);

  expect((await job())?.next_attempt_at).toBe("2026-11-03T09:10:00.000Z");
});

it("5-22: Retry-After が期限を超えるなら deadline_at にする", async () => {
  await ready();
  const gh = putFails(429, { "retry-after": String(3 * 24 * 3600) });

  await run(gh, START);

  expect((await job())?.next_attempt_at).toBe(DEADLINE);
});

it("5-22: Retry-After が HTTP 日付でも従う", async () => {
  await ready();
  const gh = putFails(429, {
    "retry-after": "Tue, 03 Nov 2026 12:00:00 GMT",
  });

  await run(gh, START);

  expect((await job())?.next_attempt_at).toBe("2026-11-03T12:00:00.000Z");
});

// 応答喪失: PUT が例外で終わる。そのあとの GET で分かれる
function lostPut(afterGet: () => Response) {
  let gets = 0;
  return fakeGitHub((req) => {
    if (req.method === "PUT") throw new TypeError("timeout");
    gets += 1;
    return gets === 1 ? notFound() : afterGet();
  });
}

it("3 節: 応答喪失のあとの GET が内容一致なら PUBLISHED", async () => {
  await ready();
  await db.insert(posts).values(post("1", DAY));
  const sha = await gitBlobSha(MD);
  const gh = lostPut(() => Response.json({ sha }));

  await run(gh, START);

  const row = await job();
  expect(row?.status).toBe("PUBLISHED");
  expect(await db.select().from(posts)).toHaveLength(0);
  expect(gh.calls.map((c) => c.method)).toEqual(["GET", "PUT", "GET"]);
});

it("3 節: 応答喪失のあとの GET が不一致なら競合として再試行（上書きしない）", async () => {
  await ready();
  const other = await gitBlobSha("別");
  const gh = lostPut(() => Response.json({ sha: other }));

  await run(gh, START);

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  expect(row?.attempts).toBe(1);
  expect(row?.error_type).toBe("conflict");
  expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
});

it("3 節: 応答喪失のあとの GET でファイルが無ければ失敗として再試行", async () => {
  await ready();
  const gh = lostPut(notFound);

  await run(gh, START);

  const row = await job();
  expect(row?.status).toBe("READY_TO_PUBLISH");
  expect(row?.attempts).toBe(1);
  expect(row?.next_attempt_at).toBe("2026-11-03T09:10:00.000Z");
});

it("5-18: 内容が違う既存ファイルは期限まで再試行し、期限後の最終試行で捨てる", async () => {
  await ready();
  const other = await gitBlobSha("別");
  const gh = fakeGitHub(() => Response.json({ sha: other }));

  await run(gh, START);
  expect((await job())?.status).toBe("READY_TO_PUBLISH");
  await settleExpired({
    db,
    token: "tok",
    now: new Date(DEADLINE),
    fetchFn: gh.fetchFn,
  });

  expect((await job())?.status).toBe("ABANDONED");
  expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
});
