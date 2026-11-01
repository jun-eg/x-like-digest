import { env } from "cloudflare:workers";
import { posts } from "@x-like-digest/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runIngest } from "../src/ingest";
import {
  clock,
  db,
  type FakeLike,
  flaky,
  harness,
  itLike,
  otherLike,
  pid,
  postCount,
  resetAll,
  seedSeen,
  seenIds,
  setState,
  state,
} from "./harness";

beforeEach(resetAll);

// 新しい順に n 件。pid(n) が最も新しい
const newest = (n: number, make = itLike): FakeLike[] =>
  Array.from({ length: n }, (_, i) => make(n - i));

describe("5-3 取得の形と応答の検証", () => {
  describe("(a) 件数と止まる位置", () => {
    it("max_results=5・tweet.fields を付け、覚えに当たったページで次を取らない", async () => {
      const h = harness();
      h.x.likes = newest(12);
      await seedSeen([pid(9)]);
      await runIngest(h.env, h.deps);
      expect(h.x.count("likes")).toBe(1);
      const url = h.x.calls.find((c) => c.kind === "likes")?.url;
      expect(url?.searchParams.get("max_results")).toBe("5");
      expect(url?.searchParams.get("tweet.fields")).toBe("created_at,entities");
      expect(await postCount()).toBe(3);
    });

    it("当たらなければ次のページを取り、当たった位置より新しい投稿だけを扱う", async () => {
      const h = harness();
      h.x.likes = newest(12);
      await seedSeen([pid(5)]);
      await runIngest(h.env, h.deps);
      expect(h.x.count("likes")).toBe(2);
      expect(
        (await db.select().from(posts)).map((p) => p.post_id).sort(),
      ).toEqual(
        [pid(12), pid(11), pid(10), pid(9), pid(8), pid(7), pid(6)].sort(),
      );
      expect(h.jevCalls).toHaveLength(7);
    });

    it("覚えが空の初回は 1 ページを覚えるだけで posts は増えない", async () => {
      const h = harness();
      h.x.likes = newest(12);
      await runIngest(h.env, h.deps);
      expect(h.x.count("likes")).toBe(1);
      expect(await postCount()).toBe(0);
      expect(h.jevCalls).toHaveLength(0);
      expect(await seenIds()).toEqual([12, 11, 10, 9, 8].map(pid));
    });
  });

  describe("(b) 10 ページ当たらない", () => {
    it("posts も seen_likes も変わらず印が立つ", async () => {
      const h = harness();
      h.x.likes = newest(60);
      await seedSeen([pid(999)]);
      await runIngest(h.env, h.deps);
      expect(h.x.count("likes")).toBe(10);
      expect(await postCount()).toBe(0);
      expect(h.jevCalls).toHaveLength(0);
      expect(await seenIds()).toEqual([pid(999)]);
      const s = await state();
      expect(s?.halted_at).toBe(clock.t);
      expect(s?.halt_reason).toBe("page_limit");
    });

    it("一覧が尽きても行き当たらなければ同じく止める", async () => {
      const h = harness();
      h.x.likes = newest(7);
      await seedSeen([pid(999)]);
      await runIngest(h.env, h.deps);
      expect(await postCount()).toBe(0);
      expect(await seenIds()).toEqual([pid(999)]);
      expect((await state())?.halt_reason).toBe("page_limit");
    });
  });

  describe("(c) 印が立っている", () => {
    it("更新・X の API・Jev・oEmbed を呼ばず、posts も増えない", async () => {
      const h = harness();
      h.x.likes = newest(4);
      await seedSeen([pid(1)]);
      await setState({
        halted_at: "2026-11-02T00:00:00.000Z",
        halt_reason: "page_limit",
      });
      await runIngest(h.env, h.deps);
      expect(h.x.calls).toHaveLength(0);
      expect(h.jevCalls).toHaveLength(0);
      expect(await postCount()).toBe(0);
      expect(await seenIds()).toEqual([pid(1)]);
    });

    it("印が立っている間は auth_failed_at も変えない", async () => {
      const h = harness();
      h.x.tokenStatus = 400;
      await setState({
        halted_at: "2026-11-02T00:00:00.000Z",
        halt_reason: "page_limit",
      });
      await runIngest(h.env, h.deps);
      expect((await state())?.auth_failed_at).toBeNull();
    });
  });

  describe("(d) 途中の失敗", () => {
    const setup = async (seed = true) => {
      const h = harness();
      h.x.likes = newest(12);
      if (seed) await seedSeen([pid(2)]);
      return h;
    };

    it("2 ページ目の取得の失敗で seen_likes は変わらず posts に行が増えず、failing_since が置かれる", async () => {
      const h = await setup();
      h.x.likesFailPages.add(2);
      await runIngest(h.env, h.deps);
      expect(await postCount()).toBe(0);
      expect(await seenIds()).toEqual([pid(2)]);
      const s = await state();
      expect(s?.failing_since).toBe(clock.t);
      expect(s?.halted_at).toBeNull();
    });

    it("D1 への書き込み（batch）の失敗でも同じ", async () => {
      const h = await setup();
      const flakyDb = flaky(env.DB, { batch: true, failures: 1 });
      await runIngest({ ...h.env, DB: flakyDb.db }, h.deps);
      expect(flakyDb.attempts()).toBe(1);
      expect(await postCount()).toBe(0);
      expect(await seenIds()).toEqual([pid(2)]);
      expect((await state())?.failing_since).toBe(clock.t);
    });

    it("同じ UTC 日の失敗では印が立たず、最初の時刻が残る", async () => {
      const h = await setup();
      h.x.likesFailPages.add(2);
      await runIngest(h.env, h.deps);
      const first = clock.t;
      clock.t = "2026-11-03T20:00:00.000Z";
      await runIngest(h.env, h.deps);
      const s = await state();
      expect(s?.halted_at).toBeNull();
      expect(s?.failing_since).toBe(first);
    });

    it("UTC の日付をまたいで失敗が続くと印が立つ", async () => {
      const h = await setup();
      h.x.likesFailPages.add(2);
      await runIngest(h.env, h.deps);
      clock.t = "2026-11-04T00:00:00.000Z";
      await runIngest(h.env, h.deps);
      const s = await state();
      expect(s?.halted_at).toBe(clock.t);
      expect(s?.halt_reason).toBe("failed_across_utc_day");
      // 印が立てば次の回は何も呼ばない
      const before = h.x.calls.length;
      await runIngest(h.env, h.deps);
      expect(h.x.calls).toHaveLength(before);
    });

    it("最後まで済んだ回の batch で failing_since が NULL に戻る", async () => {
      const h = await setup();
      h.x.likesFailPages.add(2);
      await runIngest(h.env, h.deps);
      h.x.likesFailPages.clear();
      clock.t = "2026-11-03T02:00:00.000Z";
      await runIngest(h.env, h.deps);
      expect((await state())?.failing_since).toBeNull();
      expect(await postCount()).toBe(10);
    });

    it("1 ページ目の失敗・更新の失敗・x_auth の書き込みの失敗では failing_since も印も立たない", async () => {
      const first = await setup();
      first.x.likesFailPages.add(1);
      await runIngest(first.env, first.deps);

      const refresh = await setup(false);
      refresh.x.tokenStatus = 500;
      await runIngest(refresh.env, refresh.deps);

      const write = await setup(false);
      const auth = flaky(env.AUTH_DB, {
        sql: /insert into "x_auth"/i,
        failures: 3,
      });
      await runIngest({ ...write.env, AUTH_DB: auth.db }, write.deps);

      // 日付をまたいで繰り返しても止まらない
      clock.t = "2026-11-05T00:00:00.000Z";
      await runIngest(first.env, first.deps);
      const s = await state();
      expect(s?.failing_since ?? null).toBeNull();
      expect(s?.halted_at ?? null).toBeNull();
      expect(await postCount()).toBe(0);
    });
  });

  describe("(e) 非 IT 系", () => {
    it("oEmbed の呼び出しが 0 回で posts に入らない", async () => {
      const h = harness();
      h.x.likes = [otherLike(3), otherLike(2), otherLike(1)];
      await seedSeen([pid(1)]);
      await runIngest(h.env, h.deps);
      expect(h.jevCalls).toHaveLength(2);
      expect(h.x.count("oembed")).toBe(0);
      expect(await postCount()).toBe(0);
    });

    it("oEmbed が失敗した IT 系は捨て、その回の残りは続ける", async () => {
      const h = harness();
      h.x.likes = [itLike(3), itLike(2), itLike(1)];
      h.x.oembedFail.add(pid(3));
      await seedSeen([pid(1)]);
      await runIngest(h.env, h.deps);
      expect((await db.select().from(posts)).map((p) => p.post_id)).toEqual([
        pid(2),
      ]);
      expect(await seenIds()).toEqual([pid(3), pid(2), pid(1)]);
    });
  });

  describe("(f) 形を崩した応答", () => {
    it.each([
      ["text が無い", { id: pid(3) }],
      ["text が空", { id: pid(3), text: "" }],
      [
        "entities.urls が配列でない",
        { id: pid(3), text: "IT: x", entities: { urls: 1 } },
      ],
      [
        "start が無い",
        {
          id: pid(3),
          text: "IT: x",
          entities: { urls: [{ expanded_url: "https://example.com/" }] },
        },
      ],
      ["id が数字でない", { id: "abc", text: "IT: x" }],
      ["id が無い", { text: "IT: x" }],
      ["オブジェクトでない", "tweet"],
    ])(
      "投稿の形が合わない（%s）と捨て、他の投稿は続ける",
      async (_name, raw) => {
        const h = harness();
        h.x.likes = [
          itLike(4),
          { id: pid(3), text: "", raw },
          itLike(2),
          itLike(1),
        ];
        await seedSeen([pid(1)]);
        await runIngest(h.env, h.deps);
        expect(
          (await db.select().from(posts)).map((p) => p.post_id).sort(),
        ).toEqual([pid(4), pid(2)].sort());
        expect(h.jevCalls).toHaveLength(2);
      },
    );

    it("応答全体の形が合わない 1 ページ目は何も変えず、failing_since も置かない", async () => {
      const h = harness();
      h.x.likes = newest(3);
      h.x.likesBrokenPages.add(1);
      await seedSeen([pid(1)]);
      await runIngest(h.env, h.deps);
      expect(await postCount()).toBe(0);
      expect(await seenIds()).toEqual([pid(1)]);
      expect((await state())?.failing_since ?? null).toBeNull();
    });

    it("応答全体の形が合わない 2 ページ目は失敗として数える", async () => {
      const h = harness();
      h.x.likes = newest(12);
      h.x.likesBrokenPages.add(2);
      await seedSeen([pid(2)]);
      await runIngest(h.env, h.deps);
      expect(await postCount()).toBe(0);
      expect((await state())?.failing_since).toBe(clock.t);
    });
  });

  describe("(g) seen_likes の置き換え", () => {
    it("全部扱い終えた回に、最初のページの内容（新しい順）になる", async () => {
      const h = harness();
      h.x.likes = newest(12);
      await seedSeen([pid(4), pid(3)]);
      await runIngest(h.env, h.deps);
      expect(await seenIds()).toEqual([12, 11, 10, 9, 8].map(pid));
    });

    it("最初のページが 5 件未満なら、返った件数だけ覚える", async () => {
      const h = harness();
      h.x.likes = newest(3);
      await seedSeen([pid(1)]);
      await runIngest(h.env, h.deps);
      expect(await seenIds()).toEqual([3, 2, 1].map(pid));
    });
  });

  describe("(h) first_url（9-12）", () => {
    const urlOf = async (urls: FakeLike["urls"]) => {
      // 1 件の中で 2 回呼ぶ検査があるので、毎回まっさらにする
      await resetAll();
      const h = harness();
      h.x.likes = [itLike(2, { urls }), itLike(1)];
      await seedSeen([pid(1)]);
      await runIngest(h.env, h.deps);
      const [row] = await db.select().from(posts);
      return { row, h };
    };

    it("外部リンクはその expanded_url", async () => {
      const { row } = await urlOf([
        { start: 10, expanded_url: "https://example.com/article" },
      ]);
      expect(row?.first_url).toBe("https://example.com/article");
    });

    it.each([
      ["pic.twitter.com", "https://pic.twitter.com/abc123"],
      ["x.com の写真", `https://x.com/example_user/status/${pid(2)}/photo/1`],
      ["twitter.com の投稿", `https://twitter.com/a/status/${pid(5)}`],
      ["www.x.com の投稿", `https://www.x.com/a/status/${pid(5)}`],
    ])(
      "写真リンク・投稿へのリンク（%s）は除いて first_url を省く",
      async (_name, link) => {
        const { row } = await urlOf([{ start: 10, expanded_url: link }]);
        expect(row?.post_id).toBe(pid(2));
        expect(row?.first_url).toBeNull();
      },
    );

    it("リンク無しは first_url を省く", async () => {
      const { row } = await urlOf(undefined);
      expect(row?.first_url).toBeNull();
    });

    it("start 昇順に見て、除外したリンクの後ろの最初の外部リンクを採る", async () => {
      const { row } = await urlOf([
        { start: 90, expanded_url: "https://example.com/second" },
        { start: 50, expanded_url: "https://pic.twitter.com/zzz" },
        { start: 70, expanded_url: "https://example.org/first" },
      ]);
      expect(row?.first_url).toBe("https://example.org/first");
    });

    it("expanded_url が無い・URL でない・http(s) でないものは飛ばす", async () => {
      const { row } = await urlOf([
        { start: 1 },
        { start: 2, expanded_url: "not a url" },
        { start: 3, expanded_url: "javascript:alert(1)" },
        { start: 4, expanded_url: "https://example.net/ok" },
      ]);
      expect(row?.first_url).toBe("https://example.net/ok");
    });

    it("リンクの有無で oEmbed の要求は変わらない（ID だけ）", async () => {
      const withLink = await urlOf([
        { start: 1, expanded_url: "https://example.com/a" },
      ]);
      const without = await urlOf(undefined);
      const hrefs = (h: typeof withLink.h) =>
        h.x.calls.filter((c) => c.kind === "oembed").map((c) => c.url.href);
      expect(hrefs(withLink.h)).toEqual([
        `https://publish.x.com/oembed?url=https://x.com/i/status/${pid(2)}&omit_script=true`,
      ]);
      expect(hrefs(without.h)).toEqual(hrefs(withLink.h));
    });
  });
});

describe("X の失敗応答のログ", () => {
  const logged = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => JSON.parse(String(c[0])));

  it("title・type・reason だけを出し、detail や登録先の URL は出さない", async () => {
    const h = harness();
    h.x.likes = newest(3);
    h.x.likesFailPages.add(1);
    h.x.likesFailReply = {
      status: 403,
      body: {
        title: "Client Forbidden",
        type: "https://api.twitter.com/2/problems/client-forbidden",
        reason: "client-not-enrolled",
        detail: `user ${pid(99)} の投稿は見られない（架空）`,
        registration_url: "https://developer.x.com/x?secret=1",
        client_id: "架空のクライアント",
      },
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runIngest(h.env, h.deps);
    const lines = logged(spy);
    spy.mockRestore();

    expect(lines).toContainEqual({
      event: "ingest_skipped",
      error_type: "http_403",
      x_title: "Client Forbidden",
      x_type: "https://api.twitter.com/2/problems/client-forbidden",
      x_reason: "client-not-enrolled",
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain(pid(99));
    expect(text).not.toContain("secret=1");
    expect(text).not.toContain("架空のクライアント");
  });

  it("想定外の文字を含む欄と JSON でない本文は出さない", async () => {
    const h = harness();
    h.x.likes = newest(3);
    h.x.likesFailPages.add(1);
    h.x.likesFailReply = {
      status: 403,
      body: {
        title: `Forbidden for ${pid(98)}`,
        type: 42,
        reason: 'not "fixed"',
      },
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runIngest(h.env, h.deps);
    const lines = logged(spy);
    spy.mockRestore();

    expect(lines).toContainEqual({
      event: "ingest_skipped",
      error_type: "http_403",
    });
  });
});
