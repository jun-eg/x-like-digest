import { WorkerEntrypoint } from "cloudflare:workers";

export class Summarizer extends WorkerEntrypoint<Env> {}

export default {
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
