import { posts } from "@x-like-digest/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { runIngest } from "../src/ingest";
import {
  bare,
  db,
  type FakeLike,
  harness,
  itLike,
  otherLike,
  pid,
  postCount,
  resetAll,
  seedSeen,
  seenIds,
  wrapped,
} from "./harness";

beforeEach(resetAll);

// pid(2) を新しく取り込む回。pid(1) が覚えにある
async function oneNew(
  like: FakeLike = itLike(2),
  over?: Parameters<typeof harness>[0],
  jev?: Parameters<typeof harness>[1],
) {
  const h = harness(over, jev);
  h.x.likes = [like, itLike(1)];
  await seedSeen([pid(1)]);
  return h;
}

describe("5-4 tweet_url を厳密に解析する", () => {
  it.each([
    "https://x.com/example_user",
    "https://www.x.com/example_user",
    "https://twitter.com/example_user",
    "https://www.twitter.com/example_user",
  ])(
    "author_url（%s）は受けて tweet_url を x.com で組み立て、post_id を文字列のまま入れる",
    async (authorUrl) => {
      const h = await oneNew();
      h.x.authorUrls.set(pid(2), authorUrl);
      await runIngest(h.env, h.deps);
      const [row] = await db.select().from(posts);
      expect(row).toMatchObject({
        post_id: pid(2),
        author: "example_user",
        tweet_url: `https://x.com/example_user/status/${pid(2)}`,
      });
      expect(Number.isSafeInteger(Number(pid(2)))).toBe(false);
    },
  );

  it.each([
    ["偽ホスト（x.com が先頭）", "https://x.com.evil.example/example_user"],
    ["偽ホスト（userinfo）", "https://x.com@evil.example/example_user"],
    ["偽ホスト（後ろに x.com）", "https://evilx.com/example_user"],
    ["status が付いている", "https://x.com/example_user/status/abc"],
    ["ユーザー名が空", "https://x.com/"],
    ["ユーザー名が 16 字", "https://x.com/abcdefghijklmnop"],
    ["ユーザー名に記号", "https://x.com/a-b"],
    ["http", "http://x.com/example_user"],
    ["ポート付き", "https://x.com:8443/example_user"],
    ["URL でない", "x.com/example_user"],
  ])("author_url が %s なら D1 に書かない", async (_name, authorUrl) => {
    const h = await oneNew();
    h.x.authorUrls.set(pid(2), authorUrl);
    await runIngest(h.env, h.deps);
    expect(await postCount()).toBe(0);
    expect(await seenIds()).toEqual([pid(2), pid(1)]);
  });

  it("投稿 ID が数字でない投稿は Jev にも oEmbed にも渡さない", async () => {
    const h = harness();
    h.x.likes = [
      { id: "12ab", text: "IT: x", raw: { id: "12ab", text: "IT: x" } },
      itLike(1),
    ];
    await seedSeen([pid(1)]);
    await runIngest(h.env, h.deps);
    expect(await postCount()).toBe(0);
    expect(h.jevCalls).toHaveLength(0);
    expect(h.x.count("oembed")).toBe(0);
  });

  it("oEmbed の応答の形が合わなければ捨てる", async () => {
    const h = await oneNew();
    h.deps.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.hostname === "publish.x.com")
        return Response.json({ html: "<p></p>" });
      return h.x.fetch(input, init);
    };
    await runIngest(h.env, h.deps);
    expect(await postCount()).toBe(0);
  });
});

describe("5-5 Jev で IT 系だけを残す", () => {
  it("閾値以上（0.6）は保存し、未満（0.59）は捨てる", async () => {
    const hit = await oneNew(itLike(2), undefined, async () => bare(0.6));
    await runIngest(hit.env, hit.deps);
    expect(await postCount()).toBe(1);

    await resetAll();
    const miss = await oneNew(itLike(2), undefined, async () => bare(0.59));
    await runIngest(miss.env, miss.deps);
    expect(await postCount()).toBe(0);
  });

  it("包みの付いた応答 { state, result } でも判定できる", async () => {
    const hit = await oneNew(itLike(2), undefined, async () => wrapped(0.9));
    await runIngest(hit.env, hit.deps);
    expect(await postCount()).toBe(1);

    await resetAll();
    const miss = await oneNew(itLike(2), undefined, async () => wrapped(0.1));
    await runIngest(miss.env, miss.deps);
    expect(await postCount()).toBe(0);
  });

  it("モデル ID・入力・gateway を 9-2 のとおり渡す", async () => {
    const seen: { model: unknown; input: unknown; options: unknown }[] = [];
    const h = await oneNew(itLike(2));
    h.env.AI = {
      run: async (model, input, options) => {
        seen.push({ model, input, options });
        return bare(0.99);
      },
    };
    await runIngest(h.env, h.deps);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.model).toBe("typesafe/jev");
    expect(seen[0]?.options).toEqual({ gateway: { id: "x-like-digest-jev" } });
    expect(seen[0]?.input).toMatchObject({
      state: itLike(2).text,
      questions: { it: { type: "noul" } },
    });
  });

  it("保存した行に 4-2 の列が入る", async () => {
    const h = await oneNew(
      itLike(2, {
        created_at: "2026-11-02T22:00:00.000Z",
        urls: [{ start: 3, expanded_url: "https://example.com/article" }],
      }),
    );
    await runIngest(h.env, h.deps);
    const [row] = await db.select().from(posts);
    expect(row).toMatchObject({
      post_id: pid(2),
      text: itLike(2).text,
      author: "example_user",
      tweet_url: `https://x.com/example_user/status/${pid(2)}`,
      first_url: "https://example.com/article",
      source_created_at: "2026-11-02T22:00:00.000Z",
      received_at: "2026-11-03T01:00:00.000Z",
      batch_id: null,
    });
  });
});

describe("5-6 判定失敗は捨てる", () => {
  const failures: [string, () => Promise<unknown>][] = [
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
  ];

  it.each(failures)(
    "%s は D1 に書かず、その回の残りの投稿は続ける",
    async (_name, fail) => {
      const h = harness({}, async (text) =>
        text.includes("記録 3") ? fail() : bare(0.99),
      );
      h.x.likes = [itLike(4), itLike(3), itLike(2), itLike(1)];
      await seedSeen([pid(1)]);
      await runIngest(h.env, h.deps);
      expect(
        (await db.select().from(posts)).map((p) => p.post_id).sort(),
      ).toEqual([pid(4), pid(2)].sort());
      // 捨てた投稿も覚えに入る
      expect(await seenIds()).toEqual([4, 3, 2, 1].map(pid));
    },
  );

  it("時間切れも D1 に書かず、残りは続ける", async () => {
    const h = harness(
      {},
      (text) =>
        text.includes("記録 3")
          ? new Promise(() => {})
          : Promise.resolve(bare(0.99)),
      { jevTimeoutMs: 20 },
    );
    h.x.likes = [itLike(3), itLike(2), itLike(1)];
    await seedSeen([pid(1)]);
    await runIngest(h.env, h.deps);
    expect((await db.select().from(posts)).map((p) => p.post_id)).toEqual([
      pid(2),
    ]);
  });
});

describe("5-3 oEmbed の時間切れ", () => {
  it("応答が返らない投稿は捨て、その回の残りは続ける", async () => {
    const h = harness({}, undefined, { oembedTimeoutMs: 20 });
    h.x.likes = [itLike(3), itLike(2), itLike(1)];
    await seedSeen([pid(1)]);
    const inner = h.deps.fetch;
    h.deps.fetch = (input, init) => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!href.includes(pid(3)) || !href.includes("oembed"))
        return inner(input, init);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    };
    await runIngest(h.env, h.deps);
    expect((await db.select().from(posts)).map((p) => p.post_id)).toEqual([
      pid(2),
    ]);
    expect(await seenIds()).toEqual([3, 2, 1].map(pid));
  });
});

describe("5-7 重複は冪等", () => {
  it("同じ X の API 応答を 2 回流しても 1 行で、2 回目は Jev も oEmbed も呼ばない", async () => {
    const h = await oneNew();
    await runIngest(h.env, h.deps);
    const jev = h.jevCalls.length;
    const oembed = h.x.count("oembed");
    await runIngest(h.env, h.deps);
    expect(await postCount()).toBe(1);
    expect(h.jevCalls).toHaveLength(jev);
    expect(h.x.count("oembed")).toBe(oembed);
  });

  it("本処理で保存・削除したあとに同じ応答を流しても増えない", async () => {
    const h = await oneNew();
    await runIngest(h.env, h.deps);
    // Worker B が保存して消した状態
    await db.delete(posts);
    await runIngest(h.env, h.deps);
    expect(await postCount()).toBe(0);
  });

  it("非 IT 系だけの応答を 2 回流して、2 回目の Jev の呼び出しは 0 回", async () => {
    const h = harness();
    h.x.likes = [otherLike(3), otherLike(2), otherLike(1)];
    await seedSeen([pid(1)]);
    await runIngest(h.env, h.deps);
    expect(h.jevCalls).toHaveLength(2);
    await runIngest(h.env, h.deps);
    expect(h.jevCalls).toHaveLength(2);
    expect(await postCount()).toBe(0);
  });

  it("覚えから外れてから再びいいねされた投稿は、再び取り込まれる", async () => {
    const h = harness();
    const a = itLike(10);
    const later = [15, 14, 13, 12, 11].map((n) => itLike(n));
    h.x.likes = [a, itLike(1)];
    await seedSeen([pid(1)]);
    await runIngest(h.env, h.deps);
    expect(await postCount()).toBe(1);

    // a が覚えから外れる（5 件の新しいいいねが追い越す）
    h.x.likes = [...later, a, itLike(1)];
    await runIngest(h.env, h.deps);
    expect(await seenIds()).toEqual([15, 14, 13, 12, 11].map(pid));
    await db.delete(posts);

    // a を取り消して、もう一度いいねする
    h.x.likes = [a, ...later];
    await runIngest(h.env, h.deps);
    expect((await db.select().from(posts)).map((p) => p.post_id)).toEqual([
      pid(10),
    ]);
  });
});
