export default {
  async fetch(): Promise<Response> {
    return new Response("ingest");
  },
} satisfies ExportedHandler<Env>;
