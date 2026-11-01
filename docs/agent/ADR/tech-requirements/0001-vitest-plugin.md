# ADR tech-requirements-0001: 検査のパッケージ `@cloudflare/vitest-pool-workers` が非推奨で、後継に替えた

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/tech-requirements.md — 6 節 8 行目（検査）
- **出典**: issue #12

## それまでの結論

6-8 は「vitest と `@cloudflare/vitest-pool-workers`」を採っていた。

## 何が起きたか

#12 で入れる段になって、npm 上で `@cloudflare/vitest-pool-workers` が非推奨（`@cloudflare/vitest-plugin` に改名済みで、今後更新されない）と分かった。
同梱の wrangler が 4.124 で、ルートの 4.156 と `compatibility_date` 2026-10-30 に対して古い。後継は wrangler 4.156 を同梱し、揃う。

## 新しい結論

6-8 は「vitest と `@cloudflare/vitest-plugin`」。Workers の実行環境で D1 と Service Binding を含めて動かし、外部を差し替える方針は変わらない。

## 影響

- 6-8 のパッケージ名を直し、却下列に旧パッケージを足した
- 6-14 の「vitest のプール（8）」は後継でも成り立つので変えない
