import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { build } from "esbuild";
import { defineConfig } from "vitest/config";
import {
  unstable_getMiniflareWorkerOptions,
  unstable_readConfig,
} from "wrangler";

const configPath = (name: string) => `./workers/${name}/wrangler.jsonc`;

// プールは Service Binding の先を組まないので、summarizer を束ねて補助 Worker として渡す。
// 名前と日付は summarizer の wrangler.jsonc から読み、二重に持たない。
async function summarizerWorker() {
  const config = unstable_readConfig({ config: configPath("summarizer") });
  const { workerOptions, main } = unstable_getMiniflareWorkerOptions(config);
  if (main === undefined) throw new Error("summarizer の main が読めない");
  const bundle = await build({
    entryPoints: [main],
    bundle: true,
    format: "esm",
    write: false,
    external: ["cloudflare:*"],
  });
  const [output] = bundle.outputFiles;
  if (output === undefined) throw new Error("summarizer を束ねた出力が無い");
  return {
    ...workerOptions,
    name: config.name,
    modules: [
      {
        type: "ESModule" as const,
        path: "summarizer.mjs",
        contents: output.contents,
      },
    ],
  };
}

type AuxiliaryWorker = Awaited<ReturnType<typeof summarizerWorker>>;

// マイグレーションは本番と同じ SQL を使う。置き場は wrangler.jsonc の migrations_dir と同じ
const migrations = await readD1Migrations("./packages/shared/migrations");

// secret は wrangler.jsonc に出ないので、テストだけの値をここで渡す
const worker = (
  name: string,
  workers: AuxiliaryWorker[] = [],
  bindings: Record<string, string> = {},
) => ({
  plugins: [
    cloudflareTest({
      // ingest の AI は認証無しで接続に失敗するので、リモートのバインディングは繋がない
      remoteBindings: false,
      wrangler: { configPath: configPath(name) },
      miniflare: { workers, bindings },
    }),
  ],
  test: {
    name,
    include: [`workers/${name}/test/**/*.test.ts`],
    provide: { migrations },
  },
});

export default defineConfig({
  test: {
    projects: [
      worker("ingest", [], { IFTTT_SECRET: "test-secret" }),
      worker("orchestrator", [await summarizerWorker()]),
      worker("summarizer"),
    ],
  },
});
