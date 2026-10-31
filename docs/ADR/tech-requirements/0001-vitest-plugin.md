---
source: agent/ADR/tech-requirements/0001-vitest-plugin.md
source-hash: 1aa38414a05190902c40444a1baa68c30d01a0d9
---

# ADR tech-requirements-0001 の要約: 検査のパッケージを後継に替えた

検査に採っていた `@cloudflare/vitest-pool-workers` が npm で非推奨だった。
改名先の `@cloudflare/vitest-plugin` は更新が続き、同梱の wrangler がルートと同じ 4.156 で、`compatibility_date` 2026-10-30 に合う。
旧パッケージの wrangler は 4.124 で古かった。

今は技術の要件定義 6-8 が `@cloudflare/vitest-plugin` を採っている。Workers の実行環境で D1 と Service Binding を含めて動かし、外部を差し替える方針は変わらない。

[原本](../../agent/ADR/tech-requirements/0001-vitest-plugin.md)
