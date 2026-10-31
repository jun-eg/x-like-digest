import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("GET / に応答する", async () => {
  const res = await exports.default.fetch("https://example.com/");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ingest");
});
