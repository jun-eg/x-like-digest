import { runDailyBatch } from "./batch";
import { createDb } from "./db";
import { publishReady, settleExpired } from "./publish";

export default {
  async scheduled(controller, env): Promise<void> {
    const db = createDb(env.DB);
    const now = new Date(controller.scheduledTime);
    // (a) 期限切れジョブの最終試行と処分
    await settleExpired({ db, token: env.GITHUB_TOKEN, now });
    // (b) 保存。失敗してもジョブを残すだけで投げないので、(c) は止まらない
    await publishReady({ db, token: env.GITHUB_TOKEN, now });
    await runDailyBatch({
      db,
      summarizer: env.SUMMARIZER,
      now,
    });
    // (c) が READY_TO_PUBLISH にしたジョブの最初の保存は、同じ発火で行う。
    // 次の発火まで待つと、next_attempt_at の列が 5-22 の表から 10 分ずれる
    await publishReady({ db, token: env.GITHUB_TOKEN, now });
  },
} satisfies ExportedHandler<Env>;
