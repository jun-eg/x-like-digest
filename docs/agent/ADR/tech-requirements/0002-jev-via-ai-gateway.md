# ADR tech-requirements-0002: Jev は Workers AI のモデルではなく、AI Gateway 経由の `typesafe/jev` に替えた

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/tech-requirements.md — 2 節（実行環境、投稿本文が通る経路）、9 節 2 件目
- **出典**: issue #16、ADR design-doc-0001

## それまでの結論

2 節は「Workers AI（Jev）」、経路は「Worker A → Workers AI（Jev）→ D1」。9-2 は Workers AI での Jev のモデル ID と呼び出しの形が未確定だった。

## 何が起きたか

Jev は TypeSafe AI のモデルで、Workers AI のモデルではなかった（ADR design-doc-0001）。
一時 Worker を `wrangler dev`（remote の AI バインディング）で動かし、`gateway: { id: "x-like-digest-jev" }` を付けて `typesafe/jev` を呼んだ。クレジット未購入のときは `2021: Insufficient AI Gateway credits`、存在しない gateway ID では `2001`。Top-up 後は呼べた。

## 新しい結論

- Jev は AI Gateway 経由の `typesafe/jev`（応答の `model` は `jev-1.13.0`）。人の決定（2026-11-01）で別名を採る。カタログには `typesafe/jev-1.13.0` と `-1.14.0` がある。別名が 1.14 へ移ると 0.6 を確かめていない版で判定することになるので、`model` が `jev-1.13.0` から変わったら閾値を見直す
- 呼び方は `env.AI.run("typesafe/jev", { state, questions }, { gateway: { id } })`。入力と応答の形は技術の要件定義 9-2 に書いた
- ingest の AI バインディング `{ "binding": "AI", "remote": true }` は残す。バインディングだけで Gateway を呼べるので、ingest の secret は IFTTT の共有シークレット 1 本のまま。REST で呼ぶ案は Cloudflare の API トークンが要り、secret が増えるので採らない
- gateway ID は ingest の `vars` の `AI_GATEWAY_ID` に置く。秘密ではなく、gateway を替えるときにコードを触らずに済む。gateway 指定なしでも呼べたが、指定すれば使用量が x-like-digest-jev に残る
- `vitest.config.ts` の `remoteBindings: false` は変えない。自動テストでは Jev を差し替える（5-5、5-6）

## 影響

- 2 節の「実行環境」と「投稿本文が通る経路」を書き直した
- 9-2 を確定にし、「9-2 の確定内容」を足した
- ingest の `wrangler.jsonc` に `vars.AI_GATEWAY_ID` を足し、`npm run types` で生成型を更新した
- 作業 3（Worker A の実装）は、応答の包み（`state`・`result`）を zod で受ける形を実機で決める
