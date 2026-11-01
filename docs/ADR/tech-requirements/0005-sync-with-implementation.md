---
source: agent/ADR/tech-requirements/0005-sync-with-implementation.md
source-hash: 326bc1a160e2ab6c0ae4b503df8bdcb36082019b
---

# ADR tech-requirements-0005 の要約: 権限の判定を、設定ファイルで secret を探す形から 2 本に分けた

secret は `wrangler secret put` で入り設定ファイルに出ないので、5-25・5-26 の「設定に Claude API キーが無い」は成り立たなかった。

今は (a) 設定にバインディングが無い（CI の `grep`）と (b) `wrangler secret list` の名前が 1 本だけ（人が手元で）の 2 本で、Worker A の行も足した。
8 節は作業 1 に Biome・CI・D1・実機確認・deploy・secret・本番スキーマを実績として書き、再 deploy と本番マイグレーションを依存に足した。
起動テストは ingest を 5-1 の検査に置き換え、summarizer の `ping()` は 5-11 に認めて残す。既存の仕様は変えていない。

[原本](../../agent/ADR/tech-requirements/0005-sync-with-implementation.md)
