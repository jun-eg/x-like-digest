import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { jobs, posts } from "@x-like-digest/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import {
  auditLogs,
  captureLogs,
} from "../../../packages/shared/test-support/log-audit";
import { runDailyBatch, type Summarizer } from "../src/batch";
import { createDb } from "../src/db";
import worker from "../src/index";
import { gitBlobSha, publishReady, settleExpired } from "../src/publish";

// 5-28: 本処理・保存・再試行の全経路を流し、ログ出力に本文の一部と秘密が混ざった件数を数える
const DAY = "2026-11-03";
const START = new Date(`${DAY}T09:00:00.000Z`);
const DEADLINE = new Date(START.getTime() + 24 * 3600 * 1000);
const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00.000Z`);

const GITHUB_TOKEN = "test-github-token";
const ANTHROPIC_API_KEY = "test-anthropic-api-key";
const X_SECRETS = [
  "test-seed-refresh-token",
  "test-client-id",
  "1111111111111111111",
];
const FRAGMENTS = ["D1 を触った記録", "ダイジェスト本文の断片", "架空"];
const SECRETS = [GITHUB_TOKEN, ANTHROPIC_API_KEY, ...X_SECRETS];
const LEAK = `${GITHUB_TOKEN} ${ANTHROPIC_API_KEY} ${FRAGMENTS.join(" ")}`;
const MD = `# IT Daily Digest — ${DAY}\n\n${FRAGMENTS[1]}（架空）\n`;

const db = createDb(env.DB);

const post = (id: string, batch_id: string | null) => ({
  post_id: id,
  text: `${FRAGMENTS[0]} ${id}（架空）`,
  author: "alice",
  tweet_url: `https://x.com/alice/status/${id}`,
  received_at: `${DAY}T01:00:00.000Z`,
  batch_id,
});

const readyJob = (
  status: "READY_TO_PUBLISH" | "PUBLISHED" = "READY_TO_PUBLISH",
) =>
  db.insert(jobs).values({
    job_id: DAY,
    processed_date: DAY,
    post_count: 1,
    status,
    markdown: status === "PUBLISHED" ? null : MD,
    attempts: 0,
    next_attempt_at: START.toISOString(),
    deadline_at: DEADLINE.toISOString(),
  });

// 失敗の応答にも秘密と本文を混ぜる。ログに出る道があれば拾う
const failing = (
  status: number,
  headers?: Record<string, string>,
  message = LEAK,
) =>
  (async (_input, init) =>
    init?.method === "PUT"
      ? Response.json({ message }, { status, headers })
      : Response.json(
          { message: "Not Found" },
          { status: 404 },
        )) as typeof fetch;

// PUT のあとの GET は、置いた内容の sha を返す（5-17 の確認）
const succeeding = () => {
  let put = false;
  return (async (_input, init) => {
    if (init?.method === "PUT") {
      put = true;
      return Response.json({ commit: { sha: "c0ffee" } }, { status: 201 });
    }
    return put
      ? Response.json({ sha: await gitBlobSha(MD) })
      : Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
};

// 指定した SQL か batch を失敗させる D1 の包み
function broken(rule: { sql?: RegExp; batch?: boolean }): D1Database {
  const gate = <T extends object>(stmt: T): T =>
    new Proxy(stmt, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        if (prop === "bind")
          return (...args: unknown[]) =>
            gate(Reflect.apply(value, target, args));
        if (
          prop === "run" ||
          prop === "all" ||
          prop === "raw" ||
          prop === "first"
        )
          return async () => {
            throw new Error(`d1 down ${LEAK}`);
          };
        return value.bind(target);
      },
    });
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare" && rule.sql !== undefined) {
        const pattern = rule.sql;
        return (sql: string) => {
          const stmt = target.prepare(sql);
          return pattern.test(sql) ? gate(stmt) : stmt;
        };
      }
      if (prop === "batch" && rule.batch)
        return async () => {
          throw new Error(`d1 down ${LEAK}`);
        };
      const value: unknown = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const summarizerThrowing = (e: Error): Summarizer => ({
  summarize: async () => {
    throw e;
  },
});
const summarizerOk: Summarizer = {
  summarize: async () => ({ markdown: MD }),
};

type Scenario = {
  name: string;
  events: string[];
  run: () => Promise<void>;
};

const publish = (fetchFn: typeof fetch, now = at("09:30"), dbx = db) =>
  publishReady({ db: dbx, token: GITHUB_TOKEN, now, fetchFn });

const scenarios: Scenario[] = [
  {
    name: "本処理: 0 件で SKIPPED",
    events: ["batch_skipped"],
    run: () =>
      runDailyBatch({ db, summarizer: summarizerOk, now: at("09:05") }),
  },
  {
    name: "本処理: 要約が成功して READY_TO_PUBLISH",
    events: ["batch_ready"],
    run: async () => {
      await db.insert(posts).values(post("1", null));
      await runDailyBatch({ db, summarizer: summarizerOk, now: at("09:05") });
    },
  },
  {
    name: "本処理: 要約が本文と API キー入りの例外で失敗して ABANDONED",
    events: ["batch_abandoned"],
    run: async () => {
      await db.insert(posts).values(post("1", null));
      await runDailyBatch({
        db,
        summarizer: summarizerThrowing(new Error(`Claude 失敗 ${LEAK}`)),
        now: at("09:05"),
      });
    },
  },
  {
    name: "保存: 成功して PUBLISHED、投稿を削除",
    events: ["batch_published", "batch_posts_deleted"],
    run: async () => {
      await readyJob();
      await db.insert(posts).values(post("1", DAY));
      await publish(succeeding());
    },
  },
  {
    name: "保存: 成功したが投稿の削除に失敗",
    events: ["batch_published", "delete_failed"],
    run: async () => {
      await readyJob();
      await db.insert(posts).values(post("1", DAY));
      await publish(
        succeeding(),
        at("09:30"),
        createDb(broken({ sql: /delete from "posts"/i })),
      );
    },
  },
  {
    name: "再試行: 500 は次の回へ",
    events: ["publish_failed"],
    run: async () => {
      await readyJob();
      await publish(failing(500));
    },
  },
  {
    name: "再試行: 429 と Retry-After",
    events: ["publish_failed"],
    run: async () => {
      await readyJob();
      await publish(failing(429, { "retry-after": "120" }));
    },
  },
  {
    name: "再試行: 403 の本文が rate limit",
    events: ["publish_failed"],
    run: async () => {
      await readyJob();
      await publish(failing(403, undefined, `rate limit ${LEAK}`));
    },
  },
  {
    name: "即時打ち切り: 403（本文と秘密入り）",
    events: ["publish_failed", "batch_abandoned"],
    run: async () => {
      await readyJob();
      await db.insert(posts).values(post("1", DAY));
      await publish(failing(403));
    },
  },
  {
    name: "再試行: 通信失敗（例外の message にトークン）",
    events: ["publish_failed"],
    run: async () => {
      await readyJob();
      await publish((async () => {
        throw new TypeError(`fetch failed ${LEAK}`);
      }) as typeof fetch);
    },
  },
  {
    name: "再試行: 応答が壊れている",
    events: ["publish_failed"],
    run: async () => {
      await readyJob();
      await publish((async (_i, init) =>
        init?.method === "PUT"
          ? Response.json({ unexpected: LEAK }, { status: 201 })
          : Response.json(
              { message: "Not Found" },
              { status: 404 },
            )) as typeof fetch);
    },
  },
  {
    name: "期限後の最終試行が失敗して ABANDONED",
    events: ["publish_failed", "batch_abandoned"],
    run: async () => {
      await readyJob();
      await db.insert(posts).values(post("1", DAY));
      await settleExpired({
        db,
        token: GITHUB_TOKEN,
        now: at("09:30", "2026-11-04"),
        fetchFn: failing(500),
      });
    },
  },
  {
    name: "期限後の最終試行が成功",
    events: ["batch_published"],
    run: async () => {
      await readyJob();
      await settleExpired({
        db,
        token: GITHUB_TOKEN,
        now: at("09:30", "2026-11-04"),
        fetchFn: succeeding(),
      });
    },
  },
  {
    name: "失敗の記録にも失敗",
    events: ["publish_failed", "settle_failed"],
    run: async () => {
      await readyJob();
      await publish(
        failing(500),
        at("09:30"),
        createDb(broken({ batch: true, sql: /update "jobs"/i })),
      );
    },
  },
  {
    name: "scheduled: 本処理から保存まで",
    events: ["batch_abandoned"],
    run: async () => {
      await db.insert(posts).values(post("1", null));
      const spy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new TypeError(`network down ${LEAK}`));
      try {
        const ctx = createExecutionContext();
        const handler: ExportedHandler<Env> = worker;
        await handler.scheduled?.(
          createScheduledController({
            scheduledTime: at("09:05"),
            cron: "*/10 * * * *",
          }),
          {
            ...env,
            SUMMARIZER: summarizerThrowing(
              new Error(LEAK),
            ) as unknown as Env["SUMMARIZER"],
          },
          ctx,
        );
        await waitOnExecutionContext(ctx);
      } finally {
        spy.mockRestore();
      }
    },
  },
];

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
});

beforeEach(async () => {
  await db.delete(posts);
  await db.delete(jobs);
});

describe("5-28 本処理・保存・再試行のログに本文と秘密を含めない", () => {
  let cap = captureLogs();
  beforeEach(() => {
    cap = captureLogs();
  });
  afterEach(() => cap.restore());

  it.each(scenarios)("$name", async ({ events, run }) => {
    await run();
    const logged = cap.lines.map((l) => JSON.parse(l).event);
    for (const e of events) expect(logged).toContain(e);
    expect(
      auditLogs(cap.lines, { secrets: SECRETS, fragments: FRAGMENTS }),
    ).toEqual([]);
  });

  it("検査自体が混入を数える（本文・秘密・範囲外の欄）", () => {
    const found = auditLogs(
      [
        JSON.stringify({ event: "x", markdown: MD }),
        JSON.stringify({ event: "x", error_type: GITHUB_TOKEN }),
        JSON.stringify({ event: "x", error_type: FRAGMENTS[0] }),
      ],
      { secrets: SECRETS, fragments: FRAGMENTS },
    );
    expect(found.length).toBeGreaterThanOrEqual(4);
  });
});
