import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("RPC を呼べる", async () => {
  expect(await exports.Summarizer.ping()).toBe("summarizer");
});
