import { WorkerEntrypoint } from "cloudflare:workers";

export class Summarizer extends WorkerEntrypoint<Env> {
  // 起動の検査が Service Binding 越しの RPC を呼ぶための口
  ping(): string {
    return "summarizer";
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
