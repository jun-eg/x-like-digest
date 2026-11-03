import type { posts } from "./schema";

// Worker B と C の間で共有する型。同じアカウント内の Service Binding なので、実行時の検査は足さない（6-3、6-13）
export type SummarizePost = Pick<
  typeof posts.$inferSelect,
  "post_id" | "text" | "author" | "tweet_url"
>;

export type SummarizeInput = {
  posts: SummarizePost[];
  // JST の日付 YYYY-MM-DD
  digestDate: string;
};

// 失敗は値ではなく例外で返す。5-13 の不合格・Claude の失敗・入力上限超過はどれも Worker B 側で ABANDONED になる（5-14）
export type SummarizeResult = { markdown: string };
