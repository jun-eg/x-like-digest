import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { posts } from "@x-like-digest/shared";
import { count } from "drizzle-orm";
import { beforeEach, describe, expect, inject, it } from "vitest";
import { createDb } from "../src/db";
import { handle, type IngestEnv } from "../src/index";

const db = createDb(env.DB);
const SECRET = "test-secret";
const URL_ = "https://example.com/webhooks/x-like";

// 19 桁。JavaScript の安全な整数（2^53 - 1）を超える
const POST_ID = "1234567890123456789";
const goodBody = {
  text: "Workers の D1 に Drizzle でマイグレーションを流す手順を書いた（架空）",
  author: "example_user",
  tweet_url: `https://x.com/example_user/status/${POST_ID}`,
};

type Fake = (input: unknown) => Promise<unknown>;

const bare = (noul: number) => ({
  answers: { it: { type: "noul", noul } },
  model: "jev-1.13.0",
  usage: { input_tokens: 360, output_tokens: 21 },
});
const wrapped = (noul: number) => ({ state: "Completed", result: bare(noul) });

function envWith(fake: Fake): { env: IngestEnv; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    env: {
      DB: env.DB,
      AI_GATEWAY_ID: env.AI_GATEWAY_ID,
      IFTTT_SECRET: env.IFTTT_SECRET,
      AI: {
        run: async (_model, input) => {
          calls.push(input);
          return fake(input);
        },
      },
    },
  };
}

const itJev: Fake = async () => bare(0.99);

function post(
  body: unknown,
  init: { headers?: Record<string, string>; raw?: string } = {},
) {
  return new Request(URL_, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      ...init.headers,
    },
    body: init.raw ?? JSON.stringify(body),
  });
}

async function rows(): Promise<number> {
  const [r] = await db.select({ n: count() }).from(posts);
  return r?.n ?? 0;
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
  await db.delete(posts);
});

describe("5-1 入口は POST /webhooks/x-like だけ", () => {
  it("GET / は 404 か 405", async () => {
    const res = await exports.default.fetch("https://example.com/");
    expect([404, 405]).toContain(res.status);
  });

  it("POST /other は 404 か 405", async () => {
    const res = await exports.default.fetch("https://example.com/other", {
      method: "POST",
    });
    expect([404, 405]).toContain(res.status);
  });

  it("GET /webhooks/x-like は 405", async () => {
    const res = await exports.default.fetch(URL_);
    expect(res.status).toBe(405);
  });
});

describe("5-2 共有シークレットで認証する", () => {
  it.each([
    ["誤った値", { authorization: "Bearer wrong" }],
    ["Bearer 無し", { authorization: SECRET }],
    ["ヘッダ無し", { authorization: "" }],
  ])("%s は 401 で D1 に書かない", async (_name, headers) => {
    const { env: e, calls } = envWith(itJev);
    const req = post(goodBody, { headers });
    if (headers.authorization === "") req.headers.delete("authorization");
    const res = await handle(req, e);
    expect(res.status).toBe(401);
    expect(await rows()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("worker 本体でも誤った secret は 401 で 0 行", async () => {
    const res = await exports.default.fetch(URL_, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong",
        "content-type": "application/json",
      },
      body: JSON.stringify(goodBody),
    });
    expect(res.status).toBe(401);
    expect(await rows()).toBe(0);
  });
});

describe("5-3 JSON を検証する", () => {
  const { env: e } = envWith(itJev);

  it("Content-Type が application/json でなければ 415", async () => {
    const res = await handle(
      post(goodBody, { headers: { "content-type": "text/plain" } }),
      e,
    );
    expect(res.status).toBe(415);
  });

  it("charset 付きの application/json は受ける", async () => {
    const res = await handle(
      post(goodBody, {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
      e,
    );
    expect(res.status).toBe(200);
  });

  it("16 KiB を超えれば 413", async () => {
    const big = { ...goodBody, text: "あ".repeat(16 * 1024) };
    const res = await handle(post(big), e);
    expect(res.status).toBe(413);
    expect(await rows()).toBe(0);
  });

  it("16 KiB ちょうどは 413 にしない", async () => {
    const base = JSON.stringify({ ...goodBody, text: "" }).length;
    const text = "a".repeat(16 * 1024 - base);
    const raw = JSON.stringify({ ...goodBody, text });
    expect(new TextEncoder().encode(raw).byteLength).toBe(16 * 1024);
    const res = await handle(post(undefined, { raw }), e);
    expect(res.status).toBe(200);
  });

  it("JSON でない Body は 400", async () => {
    const res = await handle(post(undefined, { raw: "{not json" }), e);
    expect(res.status).toBe(400);
  });

  it.each([
    ["text が無い", { author: goodBody.author, tweet_url: goodBody.tweet_url }],
    ["author が無い", { text: goodBody.text, tweet_url: goodBody.tweet_url }],
    ["tweet_url が無い", { text: goodBody.text, author: goodBody.author }],
    ["text が文字列でない", { ...goodBody, text: 1 }],
    ["想定外フィールド", { ...goodBody, TweetEmbedCode: "<blockquote>" }],
    ["first_url が URL でない", { ...goodBody, first_url: "not a url" }],
  ])("%s は 400", async (_name, body) => {
    const res = await handle(post(body), e);
    expect(res.status).toBe(400);
    expect(await rows()).toBe(0);
  });
});

describe("5-4 tweet_url を厳密に解析する", () => {
  it.each([
    ["x.com", `https://x.com/a/status/${POST_ID}`],
    ["www.x.com", `https://www.x.com/a/status/${POST_ID}`],
    ["twitter.com", `https://twitter.com/a/status/${POST_ID}`],
    ["www.twitter.com", `https://www.twitter.com/a/status/${POST_ID}`],
  ])(
    "%s は受けて post_id を数字文字列のまま入れる",
    async (_name, tweet_url) => {
      const { env: e } = envWith(itJev);
      const res = await handle(post({ ...goodBody, tweet_url }), e);
      expect(res.status).toBe(200);
      const [row] = await db.select().from(posts);
      expect(row?.post_id).toBe(POST_ID);
      expect(Number.isSafeInteger(Number(POST_ID))).toBe(false);
    },
  );

  it.each([
    [
      "偽ホスト（x.com が先頭）",
      `https://x.com.evil.example/a/status/${POST_ID}`,
    ],
    ["偽ホスト（userinfo）", `https://x.com@evil.example/a/status/${POST_ID}`],
    ["偽ホスト（後ろに x.com）", `https://evilx.com/a/status/${POST_ID}`],
    ["数字でない ID", "https://x.com/a/status/abc"],
    ["status が無い", "https://x.com/a/likes/123"],
    ["ID の後ろに余り", `https://x.com/a/status/${POST_ID}/photo/1`],
    ["http", `http://x.com/a/status/${POST_ID}`],
    ["URL でない", "x.com/a/status/123"],
  ])("%s は 400", async (_name, tweet_url) => {
    const { env: e, calls } = envWith(itJev);
    const res = await handle(post({ ...goodBody, tweet_url }), e);
    expect(res.status).toBe(400);
    expect(await rows()).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("5-5 Jev で IT 系だけを残す", () => {
  it("閾値以上（0.6）は保存する", async () => {
    const { env: e } = envWith(async () => bare(0.6));
    const res = await handle(post(goodBody), e);
    expect(res.status).toBe(200);
    expect(await rows()).toBe(1);
  });

  it("閾値未満は捨てて 2xx", async () => {
    const { env: e } = envWith(async () => bare(0.59));
    const res = await handle(post(goodBody), e);
    expect(res.status).toBe(200);
    expect(await rows()).toBe(0);
  });

  it("包みの付いた応答 { state, result } でも判定できる", async () => {
    const hit = envWith(async () => wrapped(0.9));
    expect((await handle(post(goodBody), hit.env)).status).toBe(200);
    expect(await rows()).toBe(1);
    await db.delete(posts);
    const miss = envWith(async () => wrapped(0.1));
    expect((await handle(post(goodBody), miss.env)).status).toBe(200);
    expect(await rows()).toBe(0);
  });

  it("モデル ID・入力・gateway を 9-2 のとおり渡す", async () => {
    const seen: { model: unknown; input: unknown; options: unknown }[] = [];
    const e: IngestEnv = {
      DB: env.DB,
      AI_GATEWAY_ID: "x-like-digest-jev",
      IFTTT_SECRET: SECRET,
      AI: {
        run: async (model, input, options) => {
          seen.push({ model, input, options });
          return bare(0.99);
        },
      },
    };
    await handle(post(goodBody), e);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.model).toBe("typesafe/jev");
    expect(seen[0]?.options).toEqual({ gateway: { id: "x-like-digest-jev" } });
    expect(seen[0]?.input).toMatchObject({
      state: goodBody.text,
      questions: { it: { type: "noul" } },
    });
  });

  it("保存した行に 4-2 の列が入る", async () => {
    const { env: e } = envWith(itJev);
    await handle(
      post({
        ...goodBody,
        first_url: "https://example.com/article",
        created_at: "2026-10-31T01:00:00Z",
      }),
      e,
    );
    const [row] = await db.select().from(posts);
    expect(row).toMatchObject({
      post_id: POST_ID,
      text: goodBody.text,
      author: goodBody.author,
      tweet_url: goodBody.tweet_url,
      first_url: "https://example.com/article",
      source_created_at: "2026-10-31T01:00:00Z",
      batch_id: null,
    });
    expect(Number.isNaN(Date.parse(row?.received_at ?? ""))).toBe(false);
  });
});

describe("5-6 判定失敗は捨てる", () => {
  it.each([
    [
      "例外",
      async () => {
        throw new Error("boom");
      },
    ],
    [
      "残高切れ（2021）",
      async () => {
        const err = new Error("2021: Insufficient AI Gateway credits");
        err.name = "AiGatewayError";
        throw err;
      },
    ],
    ["形式不正（answers が無い）", async () => ({ foo: 1 })],
    ["形式不正（noul が範囲外）", async () => bare(1.5)],
    ["null", async () => null],
  ] satisfies [string, Fake][])(
    "%s で 2xx、D1 に書かない",
    async (_name, fake) => {
      const { env: e } = envWith(fake);
      const res = await handle(post(goodBody), e);
      expect(res.status).toBe(200);
      expect(await rows()).toBe(0);
    },
  );

  it("時間切れで 2xx、D1 に書かない", async () => {
    const { env: e } = envWith(() => new Promise(() => {}));
    const res = await handle(post(goodBody), e);
    expect(res.status).toBe(200);
    expect(await rows()).toBe(0);
  }, 15000);
});

describe("5-7 重複は冪等", () => {
  it("同じ Body を 2 回送っても 1 行で、2 回目も 2xx", async () => {
    const { env: e, calls } = envWith(itJev);
    const first = await handle(post(goodBody), e);
    const second = await handle(post(goodBody), e);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await rows()).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("最初の受信を採る", async () => {
    const { env: e } = envWith(itJev);
    await handle(post(goodBody), e);
    await handle(post({ ...goodBody, text: "2 回目の本文" }), e);
    const [row] = await db.select().from(posts);
    expect(row?.text).toBe(goodBody.text);
  });
});
