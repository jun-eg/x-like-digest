import {
  ingest_state,
  type NewPost,
  posts,
  seen_likes,
} from "@x-like-digest/shared";
import { isNotNull } from "drizzle-orm";
import { createDb } from "./db";
import { type Deps, defaultDeps, errorType, log } from "./deps";
import { type JevRunner, judgeIt } from "./jev";
import { fetchAuthor } from "./oembed";
import { parsePostId, payloadSchema } from "./payload";
import {
  clearAuthFailed,
  halt,
  markAuthFailed,
  readSeen,
  readState,
  recordFailure,
} from "./state";
import { fetchLikedPage, type LikeEntry, pickFirstUrl } from "./x-api";
import { obtainAccessToken } from "./x-auth";

// 本体の Env から使う分だけを取る。テストが AI を差し替えられる
export interface IngestEnv {
  DB: D1Database;
  AUTH_DB: D1Database;
  AI: JevRunner;
  AI_GATEWAY_ID: string;
  // 実行時に secret が無いことがある（.dev.vars 無し、deploy 先で消えた）
  X_REFRESH_TOKEN: string | undefined;
  X_CLIENT_ID: string | undefined;
  X_USER_ID: string | undefined;
}

// 10 ページ（50 件）で行き当たらなければ止める（9-13）
const MAX_PAGES = 10;

class PageFetchError extends Error {
  override name = "PageFetchError";
}

export async function runIngest(
  env: IngestEnv,
  deps: Deps = defaultDeps,
): Promise<void> {
  const db = createDb(env.DB);
  const now = () => deps.now().toISOString();

  // 印が立っていれば、課金の無いトークン更新も含めて何も呼ばない
  try {
    if ((await readState(db))?.halted_at) {
      log("ingest_halted");
      return;
    }
  } catch (e) {
    log("ingest_state_read_failed", { error_type: errorType(e) });
    return;
  }

  const userId = env.X_USER_ID;
  if (!userId) {
    log("ingest_skipped", { error_type: "missing_secret" });
    return;
  }

  const auth = await obtainAccessToken(env, deps);
  if (auth.kind === "unavailable") {
    log("ingest_skipped", { error_type: auth.errorType });
    return;
  }
  if (auth.kind !== "ok") {
    // 止める印とも failing_since とも別の記録。何も止めない（9-11）
    try {
      await markAuthFailed(db, now());
    } catch (e) {
      log("auth_failed_mark_failed", { error_type: errorType(e) });
    }
    log("ingest_skipped", { error_type: `auth_${auth.kind}` });
    return;
  }
  try {
    await clearAuthFailed(db);
  } catch (e) {
    log("auth_failed_clear_failed", { error_type: errorType(e) });
  }

  let seen: Set<string>;
  try {
    seen = new Set(await readSeen(db));
  } catch (e) {
    // 空と読み違えると初回の扱いになって覚えを消すので、読めなければ終える
    log("ingest_state_read_failed", { error_type: errorType(e) });
    return;
  }
  const entries: LikeEntry[] = [];
  let firstPageIds: string[] = [];
  let pageToken: string | undefined;
  let hit = -1;

  // 1 ページ目の取得が済むと課金が起きる。それ以降の失敗は次の回の取り直しで料金が重複するので数える
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await fetchLikedPage(
        userId,
        auth.accessToken,
        pageToken,
        deps,
      );
      if (result.kind === "failed") {
        if (page === 1) {
          log("ingest_skipped", {
            error_type: result.errorType,
            ...result.problem,
          });
          return;
        }
        log("page_fetch_failed", {
          page,
          error_type: result.errorType,
          ...result.problem,
        });
        throw new PageFetchError(result.errorType);
      }
      entries.push(...result.entries);
      if (page === 1) firstPageIds = result.entries.map((e) => e.id);
      // 覚えが空の初回は 1 ページを覚えるだけ
      if (seen.size === 0) break;
      hit = entries.findIndex((e) => seen.has(e.id));
      if (hit >= 0) break;
      pageToken = result.nextToken;
      if (pageToken === undefined) break;
    }

    if (seen.size > 0 && hit < 0) {
      // 何も扱わず、覚えも変えず、止める印だけ立てる
      await halt(db, now(), "page_limit");
      log("ingest_halted_now", { reason: "page_limit" });
      return;
    }

    const fresh = seen.size === 0 ? [] : entries.slice(0, hit);
    const rows = await collectPosts(env, fresh, deps);

    const replaceSeen = db.delete(seen_likes);
    const rest = [
      ...(firstPageIds.length > 0
        ? [
            db.insert(seen_likes).values(
              firstPageIds.map((post_id, i) => ({
                post_id,
                position: i + 1,
              })),
            ),
          ]
        : []),
      ...rows.map((row) => db.insert(posts).values(row).onConflictDoNothing()),
      db
        .update(ingest_state)
        .set({ failing_since: null })
        .where(isNotNull(ingest_state.failing_since)),
    ];
    await db.batch([replaceSeen, ...rest]);
    log("ingest_done", { fetched: entries.length, saved: rows.length });
  } catch (e) {
    log("ingest_failed", { error_type: errorType(e) });
    try {
      await recordFailure(db, now());
    } catch (inner) {
      log("failure_record_failed", { error_type: errorType(inner) });
    }
  }
}

// Jev・oEmbed の呼び出しは D1 の batch の前に済ませる。途中で落ちた回に posts の行を残さない（9-13）
async function collectPosts(
  env: IngestEnv,
  fresh: LikeEntry[],
  deps: Deps,
): Promise<NewPost[]> {
  const rows: NewPost[] = [];
  for (const { id, tweet } of fresh) {
    if (tweet === null) continue;
    const judgement = await judgeIt(
      env.AI,
      env.AI_GATEWAY_ID,
      tweet.text,
      deps.jevTimeoutMs,
    );
    if (judgement.kind === "failed") {
      // 本文は出さない（5-28）。保留せず捨てる（5-6）
      log("jev_failed", { error_type: judgement.errorType });
      continue;
    }
    if (judgement.kind === "not_it") continue;

    const author = await fetchAuthor(id, deps, deps.oembedTimeoutMs);
    if (author.kind === "failed") {
      log("oembed_failed", { error_type: author.errorType });
      continue;
    }
    const payload = payloadSchema.safeParse({
      text: tweet.text,
      author: author.author,
      tweet_url: `https://x.com/${author.author}/status/${id}`,
      first_url: pickFirstUrl(tweet),
      created_at: tweet.created_at,
    });
    if (!payload.success || parsePostId(payload.data.tweet_url) !== id) {
      log("post_invalid");
      continue;
    }
    rows.push({
      post_id: id,
      text: payload.data.text,
      author: payload.data.author,
      tweet_url: payload.data.tweet_url,
      first_url: payload.data.first_url ?? null,
      source_created_at: payload.data.created_at ?? null,
      received_at: deps.now().toISOString(),
    });
  }
  return rows;
}
