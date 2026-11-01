import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  type IngestState,
  ingest_state,
  posts,
  seen_likes,
} from "@x-like-digest/shared";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { inject } from "vitest";
import { x_auth } from "../src/auth-schema";
import { createDb } from "../src/db";
import type { Deps } from "../src/deps";
import type { IngestEnv } from "../src/ingest";

export const db = createDb(env.DB);
export const authDb = drizzle(env.AUTH_DB);

export const SEED_TOKEN = env.X_REFRESH_TOKEN;
export const USER_ID = env.X_USER_ID;

// 19 桁。JavaScript の安全な整数（2^53 - 1）を超える
export const pid = (n: number) => (1234567890123456000n + BigInt(n)).toString();
export const T0 = "2026-11-03T01:00:00.000Z";

export const bare = (noul: number) => ({
  answers: { it: { type: "noul", noul } },
  model: "jev-1.13.0",
  usage: { input_tokens: 360, output_tokens: 21 },
});
export const wrapped = (noul: number) => ({
  state: "Completed",
  result: bare(noul),
});

export interface FakeLike {
  id: string;
  text: string;
  created_at?: string;
  urls?: { start: number; expanded_url?: string }[];
  // 形を崩した応答を作るときに、そのまま返す
  raw?: unknown;
}

// 本文の先頭が IT なら IT 系、それ以外は非 IT 系（架空の本文）
export const itLike = (n: number, extra: Partial<FakeLike> = {}): FakeLike => ({
  id: pid(n),
  text: `IT: Workers の D1 を触った記録 ${n}（架空）`,
  created_at: "2026-11-02T22:00:00.000Z",
  ...extra,
});
export const otherLike = (n: number): FakeLike => ({
  id: pid(n),
  text: `学園祭のたこ焼きの準備 ${n}（架空）`,
});

export type TokenReply = number | "network";

export class FakeX {
  // 新しい順
  likes: FakeLike[] = [];
  tokenStatus: TokenReply = 200;
  likesFailPages = new Set<number>();
  likesBrokenPages = new Set<number>();
  oembedFail = new Set<string>();
  authorUrls = new Map<string, string>();
  tokenCount = 0;
  calls: {
    kind: "token" | "likes" | "oembed";
    url: URL;
    init?: RequestInit;
  }[] = [];
  // 最初の liked_tweets を引いた時点の x_auth（書く順序の確認）
  authAtFirstLikes: { refresh_token: string }[] | undefined;
  tokenBodies: URLSearchParams[] = [];

  count(kind: "token" | "likes" | "oembed") {
    return this.calls.filter((c) => c.kind === kind).length;
  }

  lastRefreshToken() {
    return `rt-${this.tokenCount}`;
  }

  fetch: Deps["fetch"] = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.href === "https://api.x.com/2/oauth2/token") {
      this.calls.push({ kind: "token", url, init });
      if (init?.body instanceof URLSearchParams)
        this.tokenBodies.push(init.body);
      if (this.tokenStatus === "network") throw new TypeError("network down");
      if (this.tokenStatus !== 200)
        return Response.json(
          { error: "invalid_request" },
          {
            status: this.tokenStatus,
          },
        );
      this.tokenCount++;
      return Response.json({
        token_type: "bearer",
        expires_in: 7200,
        access_token: `at-${this.tokenCount}`,
        refresh_token: this.lastRefreshToken(),
      });
    }
    if (
      url.hostname === "api.x.com" &&
      url.pathname === `/2/users/${USER_ID}/liked_tweets`
    ) {
      this.calls.push({ kind: "likes", url, init });
      if (this.authAtFirstLikes === undefined)
        this.authAtFirstLikes = await authDb.select().from(x_auth);
      const offset = Number(url.searchParams.get("pagination_token") ?? 0);
      const page = offset / 5 + 1;
      if (this.likesFailPages.has(page))
        return Response.json({ title: "Service Unavailable" }, { status: 503 });
      if (this.likesBrokenPages.has(page)) return Response.json({ data: "x" });
      const slice = this.likes.slice(offset, offset + 5);
      return Response.json({
        data: slice.length
          ? slice.map(
              (l) =>
                l.raw ?? {
                  id: l.id,
                  text: l.text,
                  created_at: l.created_at,
                  entities: l.urls ? { urls: l.urls } : undefined,
                },
            )
          : undefined,
        meta: {
          result_count: slice.length,
          next_token:
            offset + 5 < this.likes.length ? String(offset + 5) : undefined,
        },
      });
    }
    if (url.hostname === "publish.x.com" && url.pathname === "/oembed") {
      this.calls.push({ kind: "oembed", url, init });
      const id = /\/status\/(\d+)$/.exec(
        url.searchParams.get("url") ?? "",
      )?.[1];
      if (id === undefined || this.oembedFail.has(id))
        return new Response("gone", { status: 404 });
      return Response.json({
        author_name: "表示名（架空）",
        author_url:
          this.authorUrls.get(id) ?? "https://twitter.com/example_user",
        html: "<blockquote></blockquote>",
      });
    }
    throw new Error(`想定外の要求: ${url.href}`);
  };
}

export const clock = { t: T0 };

export interface Harness {
  x: FakeX;
  env: IngestEnv;
  deps: Deps;
  sleeps: number[];
  jevCalls: string[];
}

type JevReply = (text: string) => Promise<unknown>;

const stateOf = (input: unknown): string =>
  typeof input === "object" &&
  input !== null &&
  "state" in input &&
  typeof input.state === "string"
    ? input.state
    : "";

export function harness(
  over: Partial<IngestEnv> = {},
  jev: JevReply = async (text) => bare(text.startsWith("IT") ? 0.99 : 0.01),
  depsOver: Partial<Deps> = {},
): Harness {
  const x = new FakeX();
  const sleeps: number[] = [];
  const jevCalls: string[] = [];
  return {
    x,
    sleeps,
    jevCalls,
    deps: {
      fetch: x.fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => new Date(clock.t),
      ...depsOver,
    },
    env: {
      DB: env.DB,
      AUTH_DB: env.AUTH_DB,
      AI_GATEWAY_ID: env.AI_GATEWAY_ID,
      X_REFRESH_TOKEN: env.X_REFRESH_TOKEN,
      X_CLIENT_ID: env.X_CLIENT_ID,
      X_USER_ID: env.X_USER_ID,
      AI: {
        run: async (_model, input) => {
          const text = stateOf(input);
          jevCalls.push(text);
          return jev(text);
        },
      },
      ...over,
    },
  };
}

// 指定した SQL の書き込みや batch を、決めた回数だけ失敗させる D1 の包み
export function flaky(
  real: D1Database,
  rule: { sql?: RegExp; batch?: boolean; failures: number },
) {
  let attempts = 0;
  const gate = <T extends object>(stmt: T): T =>
    new Proxy(stmt, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        if (prop === "bind")
          return (...args: unknown[]) =>
            gate(Reflect.apply(value, target, args));
        if (
          prop === "run" ||
          prop === "all" ||
          prop === "raw" ||
          prop === "first"
        )
          return async (...args: unknown[]) => {
            attempts++;
            if (attempts <= rule.failures) throw new Error("d1 down");
            return Reflect.apply(value, target, args);
          };
        return value.bind(target);
      },
    });
  const wrapped = new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare" && rule.sql !== undefined) {
        const pattern = rule.sql;
        return (sql: string) => {
          const stmt = target.prepare(sql);
          return pattern.test(sql) ? gate(stmt) : stmt;
        };
      }
      if (prop === "batch" && rule.batch) {
        return async (...args: Parameters<D1Database["batch"]>) => {
          attempts++;
          if (attempts <= rule.failures) throw new Error("d1 down");
          return target.batch(...args);
        };
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped, attempts: () => attempts };
}

export async function resetAll() {
  await applyD1Migrations(env.DB, inject("migrations"));
  await applyD1Migrations(env.AUTH_DB, inject("authMigrations"));
  await db.delete(posts);
  await db.delete(seen_likes);
  await db.delete(ingest_state);
  await authDb.delete(x_auth);
  clock.t = T0;
}

export async function postCount(): Promise<number> {
  const [r] = await db.select({ n: count() }).from(posts);
  return r?.n ?? 0;
}

export async function seenIds(): Promise<string[]> {
  const rows = await db.select().from(seen_likes);
  return rows.sort((a, b) => a.position - b.position).map((r) => r.post_id);
}

export async function seedSeen(ids: string[]) {
  await db
    .insert(seen_likes)
    .values(ids.map((post_id, i) => ({ post_id, position: i + 1 })));
}

export async function state(): Promise<IngestState | undefined> {
  const [row] = await db.select().from(ingest_state);
  return row;
}

export async function setState(values: Partial<IngestState>) {
  await db.insert(ingest_state).values({ id: 1, ...values });
}

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(d), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
