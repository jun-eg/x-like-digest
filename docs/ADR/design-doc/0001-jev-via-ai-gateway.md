---
source: agent/ADR/design-doc/0001-jev-via-ai-gateway.md
source-hash: 11cb61bea29cf0cef5e6c132f87f334028858933
---

# ADR design-doc-0001 の要約: Jev は Workers AI のモデルではなかった

Design Doc 6 節は Jev を Workers AI のモデルとして前提にしていたが、実機で見ると TypeSafe AI の `typesafe/jev` だった。

今の前提は、Cloudflare のアカウントに AI Gateway のクレジットがあること。Jev は AI Gateway 経由で呼び、支払いは Cloudflare に一括し、TypeSafe の API キーは持たない。
使用料は投稿数に比例する変動費で、1 件あたり約 $0.000015（手数料込みで月 3,000 件なら約 $0.05）。固定費 0 の判断は動かさない。

[原本](../../agent/ADR/design-doc/0001-jev-via-ai-gateway.md)
