import { z } from "zod";
import { type Deps, errorType } from "./deps";

export const PAGE_SIZE = 5;

const likesEnvelope = z.object({
  data: z.array(z.unknown()).optional(),
  meta: z.object({ next_token: z.string().optional() }).optional(),
});

const postId = z.string().regex(/^\d+$/);

const likedTweet = z.object({
  id: postId,
  text: z.string().min(1),
  created_at: z.string().min(1).optional(),
  entities: z
    .object({
      urls: z
        .array(
          z.object({
            start: z.number(),
            expanded_url: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type LikedTweet = z.infer<typeof likedTweet>;

// id だけ読めた投稿も、覚えと突き合わせる目印には使う。tweet が null の投稿は形が合わず捨てる
export interface LikeEntry {
  id: string;
  tweet: LikedTweet | null;
}

export type PageResult =
  | { kind: "ok"; entries: LikeEntry[]; nextToken: string | undefined }
  | { kind: "failed"; errorType: string };

export async function fetchLikedPage(
  userId: string,
  accessToken: string,
  paginationToken: string | undefined,
  deps: Deps,
): Promise<PageResult> {
  const params = new URLSearchParams({
    max_results: String(PAGE_SIZE),
    "tweet.fields": "created_at,entities",
  });
  if (paginationToken !== undefined)
    params.set("pagination_token", paginationToken);
  try {
    const res = await deps.fetch(
      `https://api.x.com/2/users/${encodeURIComponent(userId)}/liked_tweets?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return { kind: "failed", errorType: `http_${res.status}` };
    const envelope = likesEnvelope.safeParse(
      await res.json().catch(() => undefined),
    );
    if (!envelope.success)
      return { kind: "failed", errorType: "invalid_response" };
    const entries: LikeEntry[] = [];
    for (const raw of envelope.data.data ?? []) {
      const id = z.object({ id: postId }).safeParse(raw);
      if (!id.success) continue;
      const tweet = likedTweet.safeParse(raw);
      entries.push({
        id: id.data.id,
        tweet: tweet.success ? tweet.data : null,
      });
    }
    return {
      kind: "ok",
      entries,
      nextToken: envelope.data.meta?.next_token,
    };
  } catch (e) {
    return { kind: "failed", errorType: errorType(e) };
  }
}

const NON_EXTERNAL_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "pic.twitter.com",
]);

// 9-12。start 昇順で、投稿へのリンクと写真リンクを除いた最初の expanded_url
export function pickFirstUrl(tweet: LikedTweet): string | undefined {
  const urls = [...(tweet.entities?.urls ?? [])].sort(
    (a, b) => a.start - b.start,
  );
  for (const { expanded_url } of urls) {
    if (expanded_url === undefined) continue;
    const url = URL.parse(expanded_url);
    if (url === null) continue;
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (NON_EXTERNAL_HOSTS.has(url.hostname)) continue;
    return expanded_url;
  }
  return undefined;
}
