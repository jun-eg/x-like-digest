import { runDailyBatch } from "./batch";
import { createDb } from "./db";

export default {
  async scheduled(controller, env): Promise<void> {
    // (a) 期限切れジョブの処分、(b) 保存の再試行は作業 7・9 で埋める
    await runDailyBatch({
      db: createDb(env.DB),
      summarizer: env.SUMMARIZER,
      now: new Date(controller.scheduledTime),
    });
  },
} satisfies ExportedHandler<Env>;
