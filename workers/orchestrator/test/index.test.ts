import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../src/index";

it("scheduled を呼べる", async () => {
  const ctx = createExecutionContext();
  const handler: ExportedHandler<Env> = worker;
  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);
});

it("Service Binding 経由で summarizer の RPC を呼べる", async () => {
  expect(await env.SUMMARIZER.ping()).toBe("summarizer");
});
