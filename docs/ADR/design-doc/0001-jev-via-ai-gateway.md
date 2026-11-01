---
source: agent/ADR/design-doc/0001-jev-via-ai-gateway.md
source-hash: 9275a46dc60b1925c5aa39ae74ebac9dbfd654f5
---

# ADR design-doc-0001 の要約: Jev は Workers AI のモデルではなかった

Design Doc 6 節は Jev を Workers AI のモデルとして前提にしていたが、実機で見ると TypeSafe AI の `typesafe/jev` だった。

今の前提は、Cloudflare のアカウントに AI Gateway のクレジットがあること。Jev は AI Gateway 経由で呼び、支払いは Cloudflare に一括し、TypeSafe の API キーは持たない。
使用料は 1 件あたり約 $0.000015 で、固定費 0 の判断は動かさない。

[原本](../../agent/ADR/design-doc/0001-jev-via-ai-gateway.md)
