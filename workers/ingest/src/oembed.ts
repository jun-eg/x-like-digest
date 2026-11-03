import { z } from "zod";
import { type Deps, errorType } from "./deps";
import { TWEET_HOSTS } from "./payload";

const oembedResponse = z.object({ author_url: z.string() });
// 9-12。ユーザー名は英数字と _ の 15 字まで
const AUTHOR_PATH = /^\/([A-Za-z0-9_]{1,15})$/;

// 前方一致ではなく URL を解析して部品ごとに見る（5-4）
export function parseAuthor(authorUrl: string): string | null {
  const url = URL.parse(authorUrl);
  if (url === null) return null;
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "")
    return null;
  if (!TWEET_HOSTS.has(url.hostname)) return null;
  return AUTHOR_PATH.exec(url.pathname)?.[1] ?? null;
}

// jev.ts の注記にある 900 秒の見積もり（49 ×（10 + 5）秒）の oEmbed の分
export const OEMBED_TIMEOUT_MS = 5_000;

export type AuthorResult =
  | { kind: "ok"; author: string }
  | { kind: "failed"; errorType: string };

// 投稿 ID だけで引ける。本文もリンクの有無も要求に載せない（9-12）
export async function fetchAuthor(
  postId: string,
  deps: Deps,
  timeoutMs: number = OEMBED_TIMEOUT_MS,
): Promise<AuthorResult> {
  try {
    const res = await deps.fetch(
      `https://publish.x.com/oembed?url=https://x.com/i/status/${postId}&omit_script=true`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return { kind: "failed", errorType: `http_${res.status}` };
    const parsed = oembedResponse.safeParse(
      await res.json().catch(() => undefined),
    );
    if (!parsed.success)
      return { kind: "failed", errorType: "invalid_response" };
    const author = parseAuthor(parsed.data.author_url);
    return author === null
      ? { kind: "failed", errorType: "invalid_author_url" }
      : { kind: "ok", author };
  } catch (e) {
    return { kind: "failed", errorType: errorType(e) };
  }
}
