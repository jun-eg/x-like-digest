// 外部への口（X の API・oEmbed の fetch、待ち、時刻）。テストが差し替える
export interface Deps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  jevTimeoutMs?: number;
  oembedTimeoutMs?: number;
}

export const defaultDeps: Deps = {
  // globalThis.fetch を呼び出しの時点で引く。テストが global の fetch を差し替えても届く
  fetch: (input, init) => globalThis.fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
};

// ログは JSON 1 行。本文もトークンも出さず、種別だけ（5-2、5-28）
export function log(
  event: string,
  fields: Record<string, string | number> = {},
): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export const errorType = (e: unknown): string =>
  e instanceof Error ? e.name : "unknown";
