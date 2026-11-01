import { z } from "zod";

// 4-1。想定外のフィールドは拒否する（FR-02.4）
export const payloadSchema = z.strictObject({
  text: z.string().min(1),
  author: z.string().min(1),
  tweet_url: z.string().min(1),
  first_url: z.url().optional(),
  created_at: z.string().min(1).optional(),
});

export type Payload = z.infer<typeof payloadSchema>;

const TWEET_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
]);
const STATUS_PATH = /^\/[^/]+\/status\/(\d+)$/;

// 前方一致ではなく、URL を解析して部品ごとに見る。数字は number にせず文字列のまま返す。
export function parsePostId(tweetUrl: string): string | null {
  const url = URL.parse(tweetUrl);
  if (url === null) return null;
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "")
    return null;
  if (!TWEET_HOSTS.has(url.hostname)) return null;
  const match = STATUS_PATH.exec(url.pathname);
  return match?.[1] ?? null;
}
