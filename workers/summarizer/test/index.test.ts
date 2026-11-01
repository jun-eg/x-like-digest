import { exports } from "cloudflare:workers";
import type { SummarizeInput } from "@x-like-digest/shared";
import { describe, expect, it } from "vitest";
import {
  MAX_INPUT_CHARS,
  MODEL,
  SummarizeError,
  summarize,
} from "../src/summarize";
import { countChars, validateDigest } from "../src/validate";

const URL_A = "https://x.com/alice/status/1234567890123456789";
const URL_B = "https://twitter.com/bob/status/2234567890123456789";

const input: SummarizeInput = {
  digestDate: "2026-11-01",
  posts: [
    {
      post_id: "1234567890123456789",
      text: "Workers の話",
      author: "alice",
      tweet_url: URL_A,
    },
    {
      post_id: "2234567890123456789",
      text: "D1 の話",
      author: "bob",
      tweet_url: URL_B,
    },
  ],
};

const HEAD = [
  "# IT Daily Digest — 2026-11-01",
  "",
  "> 対象: 2投稿 / 生成: 2026-11-01 18:00 JST",
  "",
  "## 今日の要点",
  "",
  "要点。",
  "",
  "## 主要トピック",
  "",
  "### 1. Workers",
  "",
  `本文 ${URL_A}`,
  "",
  "### 2. D1",
  "",
  `本文 ${URL_B}`,
  "",
  "## 実装・学習のヒント",
  "",
].join("\n");

// 空白と改行を除いた文字数がちょうど chars になる Markdown。足りない分は最後の段落を「あ」で埋める
function digest(
  chars: number,
  edit: (md: string) => string = (m) => m,
): string {
  const base = edit(HEAD);
  const pad = chars - countChars(base);
  if (pad < 0) throw new Error(`土台が ${chars} 字を超えている`);
  return base + "あ".repeat(pad);
}

describe("5-13 形式の機械検証", () => {
  const urls = [URL_A, URL_B];

  it("全部満たす Markdown は通る（1,000 字・1,300 字を含む）", () => {
    for (const n of [1000, 1100, 1300]) {
      expect(countChars(digest(n))).toBe(n);
      expect(validateDigest(digest(n), urls)).toEqual([]);
    }
  });

  it("空は落ちる", () => {
    expect(validateDigest("", urls)).not.toEqual([]);
    expect(validateDigest(" \n\n ", urls)).not.toEqual([]);
  });

  it("文字数は 999 と 1,301 で落ちる", () => {
    expect(validateDigest(digest(999), urls)).not.toEqual([]);
    expect(validateDigest(digest(1301), urls)).not.toEqual([]);
  });

  it("文字数は空白と改行を除いたコードポイントで数える", () => {
    // サロゲートペアの 1 文字は 1 と数える
    expect(countChars("a 😀\n　b")).toBe(3);
  });

  it("見出しが欠ける・順が違う・増えると落ちる", () => {
    const missing = digest(1100, (m) => m.replace("## 今日の要点\n", ""));
    expect(validateDigest(missing, urls)).not.toEqual([]);

    const swapped = digest(1100, (m) =>
      m
        .replace("## 今日の要点", "@@A")
        .replace("## 主要トピック", "## 今日の要点")
        .replace("@@A", "## 主要トピック"),
    );
    expect(validateDigest(swapped, urls)).not.toEqual([]);

    const extra = digest(1100, (m) => `${m}\n## おまけ\n`);
    expect(validateDigest(extra, urls)).not.toEqual([]);

    const noTitle = digest(1100, (m) =>
      m.replace("# IT Daily Digest — 2026-11-01", "# 題"),
    );
    expect(validateDigest(noTitle, urls)).not.toEqual([]);
  });

  it("バッチに無い status URL があると落ちる", () => {
    const foreign = digest(1100, (m) =>
      m.replace(URL_A, "https://x.com/mallory/status/999"),
    );
    expect(validateDigest(foreign, urls)).not.toEqual([]);

    const scheme = digest(1100, (m) => `${m}\ntwitter.com/eve/status/5\n`);
    expect(validateDigest(scheme, urls)).not.toEqual([]);
  });

  it("status URL でない x.com のリンクは数えない", () => {
    const profile = digest(1100, (m) => `${m}\nhttps://x.com/alice\n`);
    expect(validateDigest(profile, urls)).toEqual([]);
  });
});

type Seen = { url: string; body: Record<string, unknown> };

function fakeClaude(reply: () => Response): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (req, init) => {
      const request = new Request(req, init);
      seen.push({ url: request.url, body: await request.json() });
      return reply();
    },
  };
}

const ok =
  (text: string, stop = "end_turn") =>
  () =>
    Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: MODEL,
      content: [{ type: "text", text }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });

describe("5-12 Claude の呼び出し", () => {
  it("モデル ID は claude-fable-5-1 で、tools を渡さず、1 回だけ呼ぶ", async () => {
    const claude = fakeClaude(ok(digest(1100)));
    const result = await summarize(input, { apiKey: "k", fetch: claude.fetch });
    expect(result.markdown).toBe(digest(1100));
    expect(claude.seen).toHaveLength(1);
    const body = claude.seen[0]?.body ?? {};
    expect(body.model).toBe("claude-fable-5-1");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("Claude が 500 を返しても再試行せず、失敗として返す", async () => {
    const claude = fakeClaude(() => new Response("boom", { status: 500 }));
    await expect(
      summarize(input, { apiKey: "k", fetch: claude.fetch }),
    ).rejects.toThrow();
    expect(claude.seen).toHaveLength(1);
  });

  it("途中で打ち切られた応答は失敗として返す", async () => {
    const claude = fakeClaude(ok(digest(1100), "max_tokens"));
    await expect(
      summarize(input, { apiKey: "k", fetch: claude.fetch }),
    ).rejects.toThrow(SummarizeError);
  });

  it("5-13 に落ちる応答は失敗として返す", async () => {
    const claude = fakeClaude(ok(digest(999)));
    await expect(
      summarize(input, { apiKey: "k", fetch: claude.fetch }),
    ).rejects.toThrow("形式の検証");
    expect(claude.seen).toHaveLength(1);
  });

  it("入力が上限を超えると Claude を呼ばず失敗として返す", async () => {
    const claude = fakeClaude(ok(digest(1100)));
    const big: SummarizeInput = {
      ...input,
      posts: [
        {
          post_id: "1",
          text: "あ".repeat(MAX_INPUT_CHARS),
          author: "alice",
          tweet_url: URL_A,
        },
      ],
    };
    await expect(
      summarize(big, { apiKey: "k", fetch: claude.fetch }),
    ).rejects.toThrow("上限");
    expect(claude.seen).toHaveLength(0);
  });

  it("API キーが無いと Claude を呼ばず失敗として返す", async () => {
    const claude = fakeClaude(ok(digest(1100)));
    await expect(
      summarize(input, { apiKey: undefined, fetch: claude.fetch }),
    ).rejects.toThrow();
    expect(claude.seen).toHaveLength(0);
  });
});

describe("5-11 Worker C は RPC だけ", () => {
  it("ping は起動確認のために残る", async () => {
    expect(await exports.Summarizer.ping()).toBe("summarizer");
  });

  it("summarize は RPC で呼べる（秘密が無い環境では失敗として返る）", async () => {
    const error = await exports.Summarizer.summarize(input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toContain("ANTHROPIC_API_KEY");
  });

  it("直接 HTTP を送っても到達しない", async () => {
    for (const [method, path] of [
      ["GET", "/"],
      ["POST", "/"],
      ["POST", "/summarize"],
    ] as const) {
      const res = await exports.default.fetch(`https://example.com${path}`, {
        method,
        body: method === "POST" ? JSON.stringify(input) : undefined,
      });
      expect(res.status).toBe(404);
    }
  });
});
