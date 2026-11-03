import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { x_auth } from "./auth-schema";
import { type Deps, errorType, log } from "./deps";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";
// 書き込みの失敗は短い待ちで直ることが多く、これ以上待つと 1 回の実行が長引く（9-11）
const WRITE_RETRY_DELAYS_MS = [1000, 2000] as const;

export interface AuthEnv {
  AUTH_DB: D1Database;
  X_REFRESH_TOKEN: string | undefined;
  X_CLIENT_ID: string | undefined;
}

export type AuthResult =
  | { kind: "ok"; accessToken: string }
  // 400・401。refresh token が使えない。auth_failed_at に記録する
  | { kind: "rejected" }
  // 新しい refresh token を 3 回書けなかった。auth_failed_at に記録する
  | { kind: "write_failed" }
  // 5xx・通信の失敗・設定の欠け。記録しない
  | { kind: "unavailable"; errorType: string };

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// access token は保存せず、取得の回ごとに更新する。新しい refresh token は access token を使う前に書く
export async function obtainAccessToken(
  env: AuthEnv,
  deps: Deps,
): Promise<AuthResult> {
  const { X_REFRESH_TOKEN: secret, X_CLIENT_ID: clientId } = env;
  if (!secret || !clientId)
    return { kind: "unavailable", errorType: "missing_secret" };

  const authDb = drizzle(env.AUTH_DB);
  let refreshToken: string;
  try {
    const row = await authDb.select().from(x_auth).limit(1);
    // Secret を入れ直すと hash が変わるので、そのときは Secret の値から始める
    refreshToken =
      row[0] !== undefined && row[0].seed_hash === (await sha256Hex(secret))
        ? row[0].refresh_token
        : secret;
  } catch (e) {
    return { kind: "unavailable", errorType: errorType(e) };
  }

  let res: Response;
  try {
    res = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
  } catch (e) {
    return { kind: "unavailable", errorType: errorType(e) };
  }
  if (res.status === 400 || res.status === 401) {
    log("x_refresh_rejected", { status: res.status });
    return { kind: "rejected" };
  }
  if (!res.ok) {
    log("x_refresh_failed", { status: res.status });
    return { kind: "unavailable", errorType: "http_error" };
  }
  const parsed = tokenResponse.safeParse(
    await res.json().catch(() => undefined),
  );
  if (!parsed.success)
    return { kind: "unavailable", errorType: "invalid_response" };

  const values = {
    id: 1,
    refresh_token: parsed.data.refresh_token,
    seed_hash: await sha256Hex(secret),
    updated_at: deps.now().toISOString(),
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await authDb
        .insert(x_auth)
        .values(values)
        .onConflictDoUpdate({ target: x_auth.id, set: values });
      return { kind: "ok", accessToken: parsed.data.access_token };
    } catch (e) {
      log("x_auth_write_failed", { error_type: errorType(e), attempt });
      const delay = WRITE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return { kind: "write_failed" };
      await deps.sleep(delay);
    }
  }
}
