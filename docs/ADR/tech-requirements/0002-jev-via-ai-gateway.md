---
source: agent/ADR/tech-requirements/0002-jev-via-ai-gateway.md
source-hash: 5919a83e928a5062cfc998162c2025d8e3f1e99f
---

# ADR tech-requirements-0002 の要約: Jev を AI Gateway 経由の typesafe/jev に替えた

技術の要件定義は Jev を Workers AI のモデルとして書いていたが、TypeSafe のモデルだった。実機で AI Gateway 経由なら呼べると確かめた。

今は `env.AI.run("typesafe/jev", { state, questions }, { gateway: { id } })` で呼ぶ。別名を採り、応答の `model` が `jev-1.13.0` から変わったら、0.6 を確かめていない版なので閾値を見直す。
ingest の AI バインディングは残し、secret は IFTTT の共有シークレット 1 本のまま。gateway ID は `vars` の `AI_GATEWAY_ID` に置く。
自動テストは Jev を差し替え、リモートには繋がない。

[原本](../../agent/ADR/tech-requirements/0002-jev-via-ai-gateway.md)
