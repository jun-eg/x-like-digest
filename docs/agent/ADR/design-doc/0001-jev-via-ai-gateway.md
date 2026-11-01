# ADR design-doc-0001: Jev は Workers AI のモデルではなく、6 節の前提が崩れた

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/design-doc.md — 6 節「前提にしている『すでにあるもの』」の Cloudflare の行
- **出典**: issue #16

## それまでの結論

6 節の前提は「Cloudflare のアカウント（Workers Free、D1 Free、Workers AI）」で、Jev を Workers AI のモデルとして呼べる前提だった。

## 何が起きたか

#16 で `npx wrangler ai models list`（73 件）を見ると jev も typesafe も無かった。人に確かめ、Jev は TypeSafe AI の `typesafe/jev` で、Workers AI のモデルではないと分かった。
Cloudflare のモデルカタログには third-party として載っており、AI Gateway 経由なら Cloudflare のクレジットで払える。実機で呼べることも確かめた（技術の要件定義 9-2）。

## 新しい結論

前提は「Cloudflare のアカウント（Workers Free、D1 Free、AI Gateway のクレジット）」。Jev は AI Gateway 経由で呼び、支払いは Cloudflare に一括する。TypeSafe の API キーは持たない。
Llama や GLM への置き換え、OpenRouter 経由、TypeSafe API の直接呼び出しは採らない。

## 影響

- 6 節の前提の表の Cloudflare の行を書き直した
- 2・5 節の「固定費 $0」は、Jev の使用料（1 件あたり約 $0.000015）が加わる。月数千件で 1 円未満なので、判断は動かさない
- 具体の呼び方は技術の要件定義へ（ADR tech-requirements-0002）
