import { posts } from "@x-like-digest/shared";
import { createDb } from "./db";
import { type JevRunner, judgeIt } from "./jev";
import { parsePostId, payloadSchema } from "./payload";

// 本体の Env から使う分だけを取る。テストが AI を差し替えられる
export interface IngestEnv {
  DB: D1Database;
  AI: JevRunner;
  AI_GATEWAY_ID: string;
  // 実行時に secret が無いことがある（.dev.vars 無し、deploy 先で消えた）
  IFTTT_SECRET: string | undefined;
}

const WEBHOOK_PATH = "/webhooks/x-like";
const MAX_BODY_BYTES = 16 * 1024;

const json = (status: number, body: Record<string, string>) =>
  Response.json(body, { status });

// 長さの違いも漏らさないよう、ハッシュにしてから定数時間で比べる
async function secretMatches(
  header: string | null,
  secret: string | undefined,
): Promise<boolean> {
  // secret が無いときに `Bearer undefined` を通さない
  if (header === null || !secret) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(header)),
    crypto.subtle.digest("SHA-256", enc.encode(`Bearer ${secret}`)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Content-Length を偽られても超えた時点で読むのをやめる
async function readLimited(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function handle(
  request: Request,
  env: IngestEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== WEBHOOK_PATH) return json(404, { error: "not_found" });
  if (request.method !== "POST")
    return json(405, { error: "method_not_allowed" });

  if (
    !(await secretMatches(
      request.headers.get("authorization"),
      env.IFTTT_SECRET,
    ))
  ) {
    return json(401, { error: "unauthorized" });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return json(415, { error: "unsupported_media_type" });
  }
  const body = await readLimited(request);
  if (body === null) return json(413, { error: "payload_too_large" });

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: "invalid_payload" });
  const payload = parsed.data;
  const postId = parsePostId(payload.tweet_url);
  if (postId === null) return json(400, { error: "invalid_tweet_url" });

  const db = createDb(env.DB);
  // 重複なら Jev を呼ばない。IFTTT の再送で課金を増やさない
  const existing = await db.query.posts.findFirst({
    columns: { post_id: true },
    where: (p, { eq }) => eq(p.post_id, postId),
  });
  if (existing !== undefined) return json(200, { status: "duplicate" });

  const judgement = await judgeIt(env.AI, env.AI_GATEWAY_ID, payload.text);
  if (judgement.kind === "failed") {
    // 本文は出さない（5-28）。保留せず捨てて 2xx（5-6）
    console.log(
      JSON.stringify({ event: "jev_failed", error_type: judgement.errorType }),
    );
    return json(200, { status: "discarded" });
  }
  if (judgement.kind === "not_it") return json(200, { status: "discarded" });

  await db
    .insert(posts)
    .values({
      post_id: postId,
      text: payload.text,
      author: payload.author,
      tweet_url: payload.tweet_url,
      first_url: payload.first_url ?? null,
      source_created_at: payload.created_at ?? null,
      received_at: new Date().toISOString(),
    })
    .onConflictDoNothing();
  return json(200, { status: "saved" });
}

export default {
  fetch: (request, env) => handle(request, env),
} satisfies ExportedHandler<Env>;
