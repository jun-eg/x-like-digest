import { vi } from "vitest";

// 5-28: ログの項目はジョブ ID、件数、エラー種別、HTTP ステータス、試行回数に限る。
// ここに無い欄が 1 つでも出たら混入として数える。
// x_title・x_type・x_reason は X の失敗応答の種別名で、エラー種別に当たるものとして数える（人の決定 2026-11-03、#66）
export const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "event", // 出来事の名前（固定の語）
  "job_id", // ジョブ ID
  "post_count", // 件数
  "fetched", // 件数
  "saved", // 件数
  "error_type", // エラー種別
  "x_title", // エラー種別
  "x_type", // エラー種別
  "x_reason", // エラー種別
  "status", // HTTP ステータス
  "attempt", // 試行回数
  "attempts", // 試行回数
]);

const MAX_STRING = 200;

export interface Capture {
  lines: string[];
  restore: () => void;
}

// console の全口を横取りする。Worker のログは console.* に出る
export function captureLogs(): Capture {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );
  return {
    lines,
    restore: () => {
      for (const s of spies) s.mockRestore();
    },
  };
}

// 混入を 1 件ずつ文にして返す。空なら混入 0
export function auditLogs(
  lines: readonly string[],
  forbidden: { secrets: readonly string[]; fragments: readonly string[] },
): string[] {
  const found: string[] = [];
  for (const line of lines) {
    if (line.includes("\n")) found.push("複数行");
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      found.push(`JSON でない行: ${line.slice(0, 40)}`);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      found.push("オブジェクトでない");
    else
      for (const [k, v] of Object.entries(parsed)) {
        if (!ALLOWED_KEYS.has(k)) found.push(`範囲外の欄: ${k}`);
        if (typeof v === "number") continue;
        if (typeof v !== "string") found.push(`範囲外の型: ${k}`);
        else if (v.length > MAX_STRING) found.push(`長すぎる値: ${k}`);
      }
    for (const s of forbidden.secrets)
      if (s !== "" && line.includes(s)) found.push("秘密の値");
    for (const f of forbidden.fragments)
      if (f !== "" && line.includes(f)) found.push("本文の一部");
  }
  return found;
}
