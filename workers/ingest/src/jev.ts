import { z } from "zod";

export const JEV_MODEL = "typesafe/jev";
export const JEV_THRESHOLD = 0.6;
// Cron Trigger の実行時間の上限は 15 分（900 秒。Cloudflare の制限）。最悪の回は 49 件（10 ページ目まで、行き当たる 1 件を除く）を
// 順に Jev にかけ、IT 系なら oEmbed も引く。49 ×（Jev 10 秒 + oEmbed 5 秒）= 735 秒で、上限に余裕をもって収まる。
// 打ち切られると recordFailure も batch も走らず、日付またぎの止め方（9-13）が効かない
const JEV_TIMEOUT_MS = 10_000;

const QUESTION = "it";

const answers = z.object({
  [QUESTION]: z.object({
    type: z.literal("noul"),
    noul: z.number().min(0).max(1),
  }),
});

// deploy した実機で包みが付くかは未確認なので両方受ける（9-2）
const bare = z.object({ answers });
const wrapped = z
  .object({ state: z.string(), result: bare })
  .transform((v) => v.result);
const jevResponse = z.union([bare, wrapped]);

export interface JevRunner {
  run(
    model: typeof JEV_MODEL,
    input: unknown,
    options: { gateway: { id: string } },
  ): Promise<unknown>;
}

const buildInput = (text: string) => ({
  state: text,
  questions: {
    [QUESTION]: {
      type: "noul",
      instructions:
        "この投稿は IT 系か。ソフトウェア開発、プログラミング、AI、データベース、ネットワーク、クラウド、セキュリティ、IT 製品・技術ニュースのいずれかを扱っていれば true。",
      criteria: {
        true: "IT・ソフトウェア・技術の話題が主題である",
        false: "IT と関係のない話題が主題である",
      },
    },
  },
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("jev timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export type Judgement =
  | { kind: "it" }
  | { kind: "not_it" }
  | { kind: "failed"; errorType: string };

// 時間切れ・例外・形式不正・残高切れ（2021）は区別せず failed にする（5-6）。捨てる扱いは同じ
export async function judgeIt(
  ai: JevRunner,
  gatewayId: string,
  text: string,
  timeoutMs: number = JEV_TIMEOUT_MS,
): Promise<Judgement> {
  try {
    const raw = await withTimeout(
      ai.run(JEV_MODEL, buildInput(text), { gateway: { id: gatewayId } }),
      timeoutMs,
    );
    const parsed = jevResponse.safeParse(raw);
    if (!parsed.success)
      return { kind: "failed", errorType: "invalid_response" };
    return parsed.data.answers[QUESTION].noul >= JEV_THRESHOLD
      ? { kind: "it" }
      : { kind: "not_it" };
  } catch (e) {
    return {
      kind: "failed",
      errorType: e instanceof Error ? e.name : "unknown",
    };
  }
}
