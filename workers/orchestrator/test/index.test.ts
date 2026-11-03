import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("Service Binding 経由で summarizer の RPC を呼べる", async () => {
  expect(await env.SUMMARIZER.ping()).toBe("summarizer");
});
