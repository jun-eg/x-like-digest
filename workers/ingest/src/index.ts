import { runIngest } from "./ingest";

// fetch ハンドラは持たない。公開面が無い（5-1）
export default {
  async scheduled(_controller, env) {
    await runIngest(env);
  },
} satisfies ExportedHandler<Env>;
