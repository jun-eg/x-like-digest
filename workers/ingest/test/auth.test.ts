import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { x_auth } from "../src/auth-schema";
import { runIngest } from "../src/ingest";
import {
  authDb,
  clock,
  flaky,
  harness,
  itLike,
  pid,
  postCount,
  resetAll,
  SEED_TOKEN,
  seedSeen,
  setState,
  sha256Hex,
  state,
} from "./harness";

beforeEach(resetAll);

// 取り込み 1 件が走る状況。覚えの先頭 1 件に行き当たる
async function ready() {
  const h = harness();
  h.x.likes = [itLike(2), itLike(1)];
  await seedSeen([pid(1)]);
  return h;
}

describe("5-2 X の認証は refresh token", () => {
  it("使う refresh token は Secret の値（x_auth が空）。client secret は付けない", async () => {
    const h = await ready();
    await runIngest(h.env, h.deps);
    const body = h.x.tokenBodies[0];
    expect(body?.get("grant_type")).toBe("refresh_token");
    expect(body?.get("refresh_token")).toBe(SEED_TOKEN);
    expect(body?.get("client_id")).toBe(env.X_CLIENT_ID);
    expect(body?.has("client_secret")).toBe(false);
    const headers = new Headers(h.x.calls[0]?.init?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("新しい refresh token を X の API を呼ぶ前に x_auth へ書く", async () => {
    const h = await ready();
    await runIngest(h.env, h.deps);
    expect(h.x.authAtFirstLikes).toHaveLength(1);
    expect(h.x.authAtFirstLikes?.[0]?.refresh_token).toBe("rt-1");
    const [row] = await authDb.select().from(x_auth);
    expect(row?.seed_hash).toBe(await sha256Hex(SEED_TOKEN));
    expect(Number.isNaN(Date.parse(row?.updated_at ?? ""))).toBe(false);
    const likes = h.x.calls.find((c) => c.kind === "likes");
    expect(new Headers(likes?.init?.headers).get("authorization")).toBe(
      "Bearer at-1",
    );
  });

  it("同じ Secret のままなら x_auth の値で更新する", async () => {
    const h = await ready();
    await runIngest(h.env, h.deps);
    await runIngest(h.env, h.deps);
    expect(h.x.tokenBodies[1]?.get("refresh_token")).toBe("rt-1");
    await runIngest(h.env, h.deps);
    expect(h.x.tokenBodies[2]?.get("refresh_token")).toBe("rt-2");
  });

  it("Secret を入れ直す（hash が違う）と Secret の値で更新する", async () => {
    const h = await ready();
    await runIngest(h.env, h.deps);
    await runIngest({ ...h.env, X_REFRESH_TOKEN: "reissued-token" }, h.deps);
    expect(h.x.tokenBodies[1]?.get("refresh_token")).toBe("reissued-token");
    const [row] = await authDb.select().from(x_auth);
    expect(row?.refresh_token).toBe("rt-2");
    expect(row?.seed_hash).toBe(await sha256Hex("reissued-token"));
  });

  it.each([400, 401])(
    "更新が %i で失敗すると posts にも Jev にも触れず auth_failed_at を置く",
    async (status) => {
      const h = await ready();
      h.x.tokenStatus = status;
      await setState({ failing_since: "2026-11-02T00:00:00.000Z" });
      await runIngest(h.env, h.deps);
      expect(await postCount()).toBe(0);
      expect(h.jevCalls).toHaveLength(0);
      expect(h.x.count("likes")).toBe(0);
      expect(h.x.count("oembed")).toBe(0);
      const s = await state();
      expect(s?.auth_failed_at).toBe(clock.t);
      // 止める印とも failing_since とも別
      expect(s?.halted_at).toBeNull();
      expect(s?.failing_since).toBe("2026-11-02T00:00:00.000Z");
      expect(await authDb.select().from(x_auth)).toHaveLength(0);
    },
  );

  it("auth_failed_at は 2 回目の失敗で変わらず、成功して書けた回に NULL に戻る", async () => {
    const h = await ready();
    h.x.tokenStatus = 400;
    await runIngest(h.env, h.deps);
    const first = clock.t;
    clock.t = "2026-11-03T02:00:00.000Z";
    await runIngest(h.env, h.deps);
    expect((await state())?.auth_failed_at).toBe(first);
    h.x.tokenStatus = 200;
    clock.t = "2026-11-03T03:00:00.000Z";
    await runIngest(h.env, h.deps);
    expect((await state())?.auth_failed_at).toBeNull();
    expect(await postCount()).toBe(1);
  });

  it.each([500, "network"] as const)(
    "更新の %s は記録せず、その回は何も呼ばずに終える",
    async (reply) => {
      const h = await ready();
      h.x.tokenStatus = reply;
      await runIngest(h.env, h.deps);
      expect((await state())?.auth_failed_at ?? null).toBeNull();
      expect(h.x.count("likes")).toBe(0);
      expect(h.jevCalls).toHaveLength(0);
    },
  );

  it.each([
    [1, [1000]],
    [2, [1000, 2000]],
  ])(
    "x_auth の書き込みを %i 回失敗させると書き直して X の API を呼ぶ",
    async (failures, sleeps) => {
      const h = await ready();
      const auth = flaky(env.AUTH_DB, {
        sql: /insert into "x_auth"/i,
        failures,
      });
      await runIngest({ ...h.env, AUTH_DB: auth.db }, h.deps);
      expect(auth.attempts()).toBe(failures + 1);
      expect(h.sleeps).toEqual(sleeps);
      expect(h.x.count("likes")).toBe(1);
      expect(await postCount()).toBe(1);
      expect((await state())?.auth_failed_at ?? null).toBeNull();
      const [row] = await authDb.select().from(x_auth);
      expect(row?.refresh_token).toBe("rt-1");
    },
  );

  it("x_auth の書き込みが 3 回とも失敗すると X の API を呼ばず auth_failed_at を置く", async () => {
    const h = await ready();
    await setState({ failing_since: "2026-11-02T00:00:00.000Z" });
    const auth = flaky(env.AUTH_DB, {
      sql: /insert into "x_auth"/i,
      failures: 3,
    });
    await runIngest({ ...h.env, AUTH_DB: auth.db }, h.deps);
    expect(auth.attempts()).toBe(3);
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.x.count("likes")).toBe(0);
    expect(h.jevCalls).toHaveLength(0);
    expect(await postCount()).toBe(0);
    const s = await state();
    expect(s?.auth_failed_at).toBe(clock.t);
    expect(s?.halted_at).toBeNull();
    expect(s?.failing_since).toBe("2026-11-02T00:00:00.000Z");
  });

  it("ログにトークンを出さない", async () => {
    const h = await ready();
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      await runIngest(h.env, h.deps);
      h.x.tokenStatus = 400;
      await runIngest(h.env, h.deps);
    } finally {
      console.log = original;
    }
    const all = lines.join("\n");
    for (const secret of [SEED_TOKEN, "rt-1", "at-1"])
      expect(all).not.toContain(secret);
  });
});
