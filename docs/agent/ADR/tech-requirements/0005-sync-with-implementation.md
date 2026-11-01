# ADR tech-requirements-0005: 権限の判定を設定ファイルで secret を探す形から、バインディングと `wrangler secret list` の 2 本に分けた

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/tech-requirements.md — 2 節「Worker ごとの持ち物」、5 節 1・11・25・26・29 行目、8 節、9-2
- **出典**: issue #38、#7 とその sub-issue #8〜#17、ADR tech-requirements-0002、ADR tech-requirements-0003、人の決定（2026-11-01）

## それまでの結論

- 5-25 は「Worker C の wrangler 設定に D1 バインディングと GitHub トークンが無い」、5-26 は「Worker B の設定に Claude API キーが無い」を、設定ファイルの `grep` で見るとしていた。Worker A の権限の行は無かった
- 8 節の作業 1 は「骨組み・wrangler 3 本・vitest・D1 スキーマ」で、deploy と本番マイグレーションの行は無く、作業 10 は「CI に `grep` 検査を足す」だった。作業 3 に Jev 応答の包みを決める文は無かった

## 何が起きたか

#7 の実装（#8〜#17）が済み、計画と突き合わせた。secret は `wrangler secret put` で入り、`wrangler.jsonc` に出ないので、5-25・5-26 の判定は成り立たない（ADR 0003 は `wrangler secret list` で確かめた）。作業 1 の実績は Biome、pre-commit と CI、D1 の作成、Jev の実機確認、deploy・secret・本番スキーマまで広がっていた。Worker A は AI バインディングと `AI_GATEWAY_ID` を持つ。ingest の `GET /` が 200 の起動テストと summarizer の `ping()` は、5-1・5-11 に無い。

## 新しい結論

- 5-25・5-26 は (a) 設定ファイルにバインディングが無い（CI の `grep`）と (b) `wrangler secret list` の名前が 1 本だけ（人が手元で）の 2 本に分け、Worker A の 5-29 を足して 3 Worker を揃えた
- 2 節に Worker ごとの持ち物を足した（A は `IFTTT_SECRET`・AI・`AI_GATEWAY_ID`・D1）
- 8 節の作業 1 に済んだ作業を実績として書き、再 deploy と本番 D1 のマイグレーション適用を依存に足した。作業 10 は既存 job「コードの検査」に step を足す形にした（job 名は ruleset に名指しされる）
- 作業 2 の検査データに Jev 応答の両方の形（包みの有無）を含め、作業 3 で zod が両方を受けるか実機で決める
- ingest の起動テストは作業 2 で 5-1 の検査に置き換える。`ping()` は起動確認用の RPC として 5-11 に認め、残す
- 5-1・5-11・5-25・5-26 の仕様そのもの、権限分離、Jev の呼び方は変えていない

## 影響

- 2 節に 1 行、5 節の 1・11・25・26 行目を直して 29 行目を足し、8 節の表と依存の二つの手を書き直した
- 実装への影響は、作業 2 で ingest の起動テストを書き換えること、作業 10 の CI の step に Worker A を含めること
- ステータス Draft はこの ADR では上げない
