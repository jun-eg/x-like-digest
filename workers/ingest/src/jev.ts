import { z } from "zod";

export const JEV_MODEL = "typesafe/jev";
export const JEV_THRESHOLD = 0.6;
// IFTTT の Webhook は 12 秒で切れる（9-8）。Jev に使えるのはその内側
const JEV_TIMEOUT_MS = 8000;

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
): Promise<Judgement> {
  try {
    const raw = await withTimeout(
      ai.run(JEV_MODEL, buildInput(text), { gateway: { id: gatewayId } }),
      JEV_TIMEOUT_MS,
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
