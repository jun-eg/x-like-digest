import { ingest_state, seen_likes } from "@x-like-digest/shared";
import { asc, isNotNull, sql } from "drizzle-orm";
import type { createDb } from "./db";

type Db = ReturnType<typeof createDb>;

const utcDate = (iso: string) => iso.slice(0, 10);

export async function readState(db: Db) {
  return db.query.ingest_state.findFirst();
}

export async function readSeen(db: Db): Promise<string[]> {
  const rows = await db
    .select({ post_id: seen_likes.post_id })
    .from(seen_likes)
    .orderBy(asc(seen_likes.position));
  return rows.map((r) => r.post_id);
}

// 最初の時刻を残す。すでに値があれば変えない（9-11）
export async function markAuthFailed(db: Db, now: string): Promise<void> {
  await db
    .insert(ingest_state)
    .values({ id: 1, auth_failed_at: now })
    .onConflictDoUpdate({
      target: ingest_state.id,
      set: {
        auth_failed_at: sql`coalesce(${ingest_state.auth_failed_at}, ${now})`,
      },
    });
}

export async function clearAuthFailed(db: Db): Promise<void> {
  await db
    .update(ingest_state)
    .set({ auth_failed_at: null })
    .where(isNotNull(ingest_state.auth_failed_at));
}

export async function halt(
  db: Db,
  now: string,
  reason: "page_limit" | "failed_across_utc_day",
): Promise<void> {
  await db
    .insert(ingest_state)
    .values({ id: 1, halted_at: now, halt_reason: reason })
    .onConflictDoUpdate({
      target: ingest_state.id,
      set: { halted_at: now, halt_reason: reason },
    });
}

// 1 ページ目の後に最後まで済まなかった回。最初の失敗の時刻を残し、UTC の日付をまたいで続いたら止める印を立てる（9-13）
export async function recordFailure(db: Db, now: string): Promise<void> {
  const state = await readState(db);
  const since = state?.failing_since ?? null;
  if (since === null) {
    await db
      .insert(ingest_state)
      .values({ id: 1, failing_since: now })
      .onConflictDoUpdate({
        target: ingest_state.id,
        set: { failing_since: now },
      });
    return;
  }
  if (utcDate(since) !== utcDate(now))
    await halt(db, now, "failed_across_utc_day");
}
