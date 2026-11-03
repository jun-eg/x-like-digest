import { runDailyBatch } from "./batch";
import { createDb } from "./db";
import { publishReady } from "./publish";

export default {
  async scheduled(controller, env): Promise<void> {
    const db = createDb(env.DB);
    const now = new Date(controller.scheduledTime);
    // (a) 期限切れジョブの処分は作業 9 で埋める
    // (b) 保存。失敗してもジョブを残すだけで投げないので、(c) は止まらない
    await publishReady({ db, token: env.GITHUB_TOKEN, now });
    await runDailyBatch({
      db,
      summarizer: env.SUMMARIZER,
      now,
    });
  },
} satisfies ExportedHandler<Env>;
