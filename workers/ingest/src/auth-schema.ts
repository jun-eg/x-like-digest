import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 認証用の D1（AUTH_DB）の表。投稿の D1 と同じ migration に入れると、Worker B に結んだ DB からも
// refresh token が読めてしまう（9-11）ので、スキーマも Worker A の中に置き、shared には出さない。
export const x_auth = sqliteTable(
  "x_auth",
  {
    id: integer("id").primaryKey(),
    refresh_token: text("refresh_token").notNull(),
    seed_hash: text("seed_hash").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [check("x_auth_single_row", sql`${t.id} = 1`)],
);
