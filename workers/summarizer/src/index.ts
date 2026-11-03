import { WorkerEntrypoint } from "cloudflare:workers";
import type { SummarizeInput, SummarizeResult } from "@x-like-digest/shared";
import { summarize } from "./summarize";

// secret は wrangler.jsonc に出ないので、wrangler types の Env に載らない。
// 実行時に無い場合があるので undefined を含める
type SummarizerEnv = Env & { ANTHROPIC_API_KEY?: string };

export class Summarizer extends WorkerEntrypoint<SummarizerEnv> {
  // 起動の検査が Service Binding 越しの RPC を呼ぶための口
  ping(): string {
    return "summarizer";
  }

  summarize(input: SummarizeInput): Promise<SummarizeResult> {
    return summarize(input, { apiKey: this.env.ANTHROPIC_API_KEY });
  }
}

// 公開ルートを持たない（5-11）
export default {
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<SummarizerEnv>;
