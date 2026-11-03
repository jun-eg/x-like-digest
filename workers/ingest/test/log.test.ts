import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditLogs,
  captureLogs,
} from "../../../packages/shared/test-support/log-audit";
import { runIngest } from "../src/ingest";
import {
  flaky,
  type Harness,
  harness,
  itLike,
  otherLike,
  pid,
  resetAll,
  SEED_TOKEN,
  seedSeen,
  setState,
} from "./harness";

// 5-28: 取り込みの全経路を流し、ログ出力に本文の一部と秘密が混ざった件数を数える
beforeEach(resetAll);

const GITHUB_TOKEN = "test-github-token";
const ANTHROPIC_API_KEY = "test-anthropic-api-key";
// トークン更新の応答で受ける値。Secret ではないが、4-2 の x_auth が「ログに出さない」とする
const issued: string[] = [];
const FRAGMENTS = ["D1 を触った記録", "学園祭のたこ焼き", "架空"];

const secrets = () => [
  SEED_TOKEN,
  env.X_CLIENT_ID,
  env.X_USER_ID,
  GITHUB_TOKEN,
  ANTHROPIC_API_KEY,
  ...issued,
];

// 更新の応答に架空のトークンを置き、失敗の応答にも秘密と本文を混ぜる。ログに出る道があれば拾う
function dirty(h: Harness) {
  const real = h.x.fetch;
  let n = 0;
  h.deps.fetch = async (input, init) => {
    const href = typeof input === "string" ? input : String(input);
    if (href !== "https://api.x.com/2/oauth2/token") return real(input, init);
    const res = await real(input, init);
    if (!res.ok)
      return Response.json(
        {
          error: "invalid_request",
          error_description: `refresh_token ${SEED_TOKEN} ${env.X_CLIENT_ID} は使えない`,
        },
        { status: res.status },
      );
    n++;
    const access_token = `NEW-ACCESS-${n}-Zq81xP`;
    const refresh_token = `NEW-REFRESH-${n}-Lm40aB`;
    issued.push(access_token, refresh_token);
    return Response.json({
      token_type: "bearer",
      expires_in: 7200,
      access_token,
      refresh_token,
    });
  };
  return h;
}

const detail = `${SEED_TOKEN} ${env.X_CLIENT_ID} ${env.X_USER_ID} ${FRAGMENTS[0]} ${FRAGMENTS[1]}`;
const failReply = (h: Harness, status: number) => {
  h.x.likesFailReply = {
    status,
    body: {
      title: "Forbidden",
      type: "about:blank",
      reason: "client-not-enrolled",
      detail,
    },
  };
};

const newest = (n: number) =>
  Array.from({ length: n }, (_, i) => itLike(n - i));

type Scenario = {
  name: string;
  events: string[];
  run: (h: Harness) => Promise<Harness["env"] | undefined>;
};

const scenarios: Scenario[] = [
  {
    name: "通常（IT 系と非 IT 系が混じる）",
    events: ["ingest_done"],
    run: async (h) => {
      h.x.likes = [itLike(3), otherLike(2), itLike(1)];
      await seedSeen([pid(1)]);
      return undefined;
    },
  },
  {
    name: "覚えが空の初回",
    events: ["ingest_done"],
    run: async (h) => {
      h.x.likes = newest(3);
      return undefined;
    },
  },
  {
    name: "5-3 トークン更新が 400",
    events: ["x_refresh_rejected", "ingest_skipped"],
    run: async (h) => {
      h.x.tokenStatus = 400;
      return undefined;
    },
  },
  {
    name: "5-3 トークン更新が 401",
    events: ["x_refresh_rejected", "ingest_skipped"],
    run: async (h) => {
      h.x.tokenStatus = 401;
      return undefined;
    },
  },
  {
    name: "トークン更新が 500",
    events: ["x_refresh_failed", "ingest_skipped"],
    run: async (h) => {
      h.x.tokenStatus = 500;
      return undefined;
    },
  },
  {
    name: "トークン更新が通信失敗",
    events: ["ingest_skipped"],
    run: async (h) => {
      h.x.tokenStatus = "network";
      return undefined;
    },
  },
  {
    name: "x_auth の書き込みが 1 回失敗して通る",
    events: ["x_auth_write_failed", "ingest_done"],
    run: async (h) => {
      h.x.likes = newest(2);
      await seedSeen([pid(1)]);
      return {
        ...h.env,
        AUTH_DB: flaky(env.AUTH_DB, {
          sql: /insert into "x_auth"/i,
          failures: 1,
        }).db,
      };
    },
  },
  {
    name: "x_auth の書き込みが 3 回とも失敗",
    events: ["x_auth_write_failed", "ingest_skipped"],
    run: async (h) => {
      h.x.likes = newest(2);
      await seedSeen([pid(1)]);
      return {
        ...h.env,
        AUTH_DB: flaky(env.AUTH_DB, {
          sql: /insert into "x_auth"/i,
          failures: 3,
        }).db,
      };
    },
  },
  {
    name: "止める印が立っている",
    events: ["ingest_halted"],
    run: async (h) => {
      h.x.likes = newest(3);
      await seedSeen([pid(1)]);
      await setState({
        halted_at: "2026-11-02T00:00:00.000Z",
        halt_reason: "page_limit",
      });
      return undefined;
    },
  },
  {
    name: "10 ページ当たらず印を立てる",
    events: ["ingest_halted_now"],
    run: async (h) => {
      h.x.likes = newest(60);
      await seedSeen([pid(999)]);
      return undefined;
    },
  },
  {
    name: "1 ページ目の失敗（本文と秘密を混ぜた応答）",
    events: ["ingest_skipped"],
    run: async (h) => {
      h.x.likes = newest(3);
      h.x.likesFailPages.add(1);
      failReply(h, 403);
      return undefined;
    },
  },
  {
    name: "途中の 2 ページ目の失敗",
    events: ["page_fetch_failed", "ingest_failed"],
    run: async (h) => {
      h.x.likes = newest(8);
      await seedSeen([pid(1)]);
      h.x.likesFailPages.add(2);
      failReply(h, 429);
      return undefined;
    },
  },
  {
    name: "応答の形が崩れている",
    events: ["ingest_skipped"],
    run: async (h) => {
      h.x.likes = newest(3);
      h.x.likesBrokenPages.add(1);
      return undefined;
    },
  },
  {
    name: "Jev が本文入りの例外を投げる",
    events: ["jev_failed", "ingest_done"],
    run: async (h) => {
      h.x.likes = newest(3);
      await seedSeen([pid(1)]);
      return undefined;
    },
  },
  {
    name: "oEmbed の失敗",
    events: ["oembed_failed", "ingest_done"],
    run: async (h) => {
      h.x.likes = newest(3);
      await seedSeen([pid(1)]);
      h.x.oembedFail.add(pid(3));
      return undefined;
    },
  },
  {
    name: "Secret が無い",
    events: ["ingest_skipped"],
    run: async (h) => ({ ...h.env, X_REFRESH_TOKEN: undefined }),
  },
  {
    name: "状態の読み出しに失敗",
    events: ["ingest_state_read_failed"],
    run: async (h) => ({
      ...h.env,
      DB: flaky(env.DB, { sql: /ingest_state/, failures: 99 }).db,
    }),
  },
  {
    name: "最後の書き込み（batch）に失敗",
    events: ["ingest_failed"],
    run: async (h) => {
      h.x.likes = newest(3);
      await seedSeen([pid(1)]);
      return {
        ...h.env,
        DB: flaky(env.DB, { batch: true, failures: 99 }).db,
      };
    },
  },
];

describe("5-28 取り込みのログに本文と秘密を含めない", () => {
  let cap = captureLogs();
  beforeEach(() => {
    cap = captureLogs();
  });
  afterEach(() => cap.restore());

  it.each(scenarios)("$name", async ({ events, run }) => {
    const h = dirty(
      harness({}, async (text) => {
        if (text.includes("IT: Workers の D1 を触った記録 2（架空）"))
          throw new Error(`Jev 失敗 ${text} ${SEED_TOKEN}`);
        return { answers: { it: { type: "noul", noul: 0.99 } } };
      }),
    );
    const override = await run(h);
    // jev_failed の場面だけ Jev を壊す（本文入りの例外）
    await runIngest(override ?? h.env, h.deps);

    const logged = cap.lines.map((l) => JSON.parse(l).event);
    for (const e of events) expect(logged).toContain(e);
    const violations = auditLogs(cap.lines, {
      secrets: secrets(),
      fragments: FRAGMENTS,
    });
    expect(violations).toEqual([]);
  });

  it("検査自体が混入を数える（本文・秘密・範囲外の欄・複数行）", () => {
    const dirtyLines = [
      JSON.stringify({ event: "x", text: "本文" }),
      JSON.stringify({ event: "x", error_type: SEED_TOKEN }),
      JSON.stringify({ event: "x", error_type: FRAGMENTS[0] }),
      "plain text",
      JSON.stringify({ event: "x" }, null, 2),
    ];
    const found = auditLogs(dirtyLines, {
      secrets: [SEED_TOKEN],
      fragments: FRAGMENTS,
    });
    expect(found.length).toBeGreaterThanOrEqual(5);
  });
});
