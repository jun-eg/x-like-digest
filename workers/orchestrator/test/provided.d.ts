import type { D1Migration } from "@cloudflare/vitest-plugin";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}
