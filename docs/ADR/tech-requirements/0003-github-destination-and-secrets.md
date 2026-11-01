---
source: agent/ADR/tech-requirements/0003-github-destination-and-secrets.md
source-hash: 581b5685ce295bd79e66f84592873586a31292d3
---

# ADR tech-requirements-0003 の要約: GitHub の保存先とトークンの範囲を決め、secret の名前を足した

技術の要件定義は GitHub の保存先とトークンの発行方式を未確定にしていた。deploy に進むため、人が決めた。

保存先は `jun-eg/my-bias` の `main`。トークンは fine-grained PAT で、対象をそのリポジトリだけに限り、権限は Contents の Read and write。
secret の名前は `IFTTT_SECRET`（ingest）、`GITHUB_TOKEN`（orchestrator）、`ANTHROPIC_API_KEY`（summarizer）。
`workers.dev` サブドメインの登録もセットアップに要る。値を埋めただけで、既存の決定は覆していない。

[原本](../../agent/ADR/tech-requirements/0003-github-destination-and-secrets.md)
