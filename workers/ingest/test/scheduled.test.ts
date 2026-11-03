import { createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  harness,
  itLike,
  pid,
  postCount,
  resetAll,
  seedSeen,
  seenIds,
} from "./harness";

beforeEach(resetAll);

describe("5-1 入口は Cron だけ", () => {
  it("fetch ハンドラを持たない（公開面が無い）", () => {
    expect("fetch" in worker).toBe(false);
    expect(typeof worker.scheduled).toBe("function");
  });

  it("scheduled を呼ぶと取り込みが 1 回走る", async () => {
    const h = harness();
    h.x.likes = [itLike(3), itLike(2), itLike(1)];
    await seedSeen([pid(1)]);
    // global の fetch を差し替えて、既定の経路（Deps 無し）で X の API に出る要求を受ける
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(h.x.fetch);
    try {
      // 本体の Env の AI は実機の口なので、Jev の差し替えを入れた env を本体の型として渡す
      await worker.scheduled(
        createScheduledController({ cron: "0 * * * *" }),
        h.env as unknown as Env,
      );
    } finally {
      spy.mockRestore();
    }
    expect(h.x.count("token")).toBe(1);
    expect(h.x.count("likes")).toBe(1);
    expect(await postCount()).toBe(2);
    expect(await seenIds()).toEqual([pid(3), pid(2), pid(1)]);
  });
});
