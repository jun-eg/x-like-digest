// 5-13。形式の機械検証だけを行い、内容の良し悪しは見ない
export const HEADINGS = [
  /^# IT Daily Digest — \d{4}-\d{2}-\d{2}$/u,
  /^## 今日の要点$/u,
  /^## 主要トピック$/u,
  /^## 実装・学習のヒント$/u,
] as const;

export const MIN_CHARS = 1000;
export const MAX_CHARS = 1300;

// 空白と改行を除いた Unicode コードポイント数。Markdown の記号は含める（6-7）
export function countChars(markdown: string): number {
  return [...markdown.replace(/\s/gu, "")].length;
}

// 前の文字が語の一部なら別のホスト（evil-x.com など）なので拾わない
const STATUS_URL =
  /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/[^\s/)\]>"'`]+\/status\/\d+/gu;

export function validateDigest(
  markdown: string,
  tweetUrls: readonly string[],
): string[] {
  if (markdown.trim() === "") {
    return ["本文が空"];
  }

  const errors: string[] = [];

  // `###` の話題見出しは数えない。見出し 4 本は # と ## だけ
  const headings = markdown
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => /^#{1,2} /u.test(line));
  const ordered =
    headings.length === HEADINGS.length &&
    HEADINGS.every((pattern, i) => pattern.test(headings[i] ?? ""));
  if (!ordered) errors.push("見出し 4 本がこの順にない");

  const chars = countChars(markdown);
  if (chars < MIN_CHARS || chars > MAX_CHARS) {
    errors.push(`文字数 ${chars} が ${MIN_CHARS}〜${MAX_CHARS} の外`);
  }

  const known = new Set(tweetUrls);
  for (const [url] of markdown.matchAll(STATUS_URL)) {
    if (!known.has(url)) errors.push(`バッチに無い URL: ${url}`);
  }

  return errors;
}
