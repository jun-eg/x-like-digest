---
source: agent/ADR/tech-requirements/0002-jev-via-ai-gateway.md
source-hash: 741bd8a93243069e6590484b043b210f530be016
---

# ADR tech-requirements-0002 の要約: Jev を AI Gateway 経由の typesafe/jev に替えた

技術の要件定義は Jev を Workers AI のモデルとして書いていたが、TypeSafe のモデルだった。実機で AI Gateway 経由なら呼べると確かめた。

今は `env.AI.run("typesafe/jev", { state, questions }, { gateway: { id } })` で呼ぶ。版は固定せず、応答の `model` が変わったら閾値を見直す。
ingest の AI バインディングは残し、secret は IFTTT の共有シークレット 1 本のまま。gateway ID は `vars` の `AI_GATEWAY_ID` に置く。
自動テストは Jev を差し替え、リモートには繋がない。

[原本](../../agent/ADR/tech-requirements/0002-jev-via-ai-gateway.md)
