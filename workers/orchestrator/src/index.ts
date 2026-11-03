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
  },
} satisfies ExportedHandler<Env>;
