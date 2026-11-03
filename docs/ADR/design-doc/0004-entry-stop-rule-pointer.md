---
source: agent/ADR/design-doc/0004-entry-stop-rule-pointer.md
source-hash: 296ce2ed560aea77199eed2aa70df1d40fe33ee3
---

# ADR design-doc-0004 の要約: 入口の「5 件とも未取得なら次のページ」だけでは止め方が決まらず、9-13 を指す一言を足した

入口の文には「未取得」の定義と次のページの止め場所が無く、初回は字義どおりに読むと過去のいいねまで取る読み方もできた。

今は、入口の文の末尾に「止め方と上限は技術の要件定義 9-13」と足してあり、最大 10 ページ、当たらなければ止める、初回は覚えるだけ、は 9-13 が持つ。取得の間隔、最新 5 件、費用の見積もりは変えていない。

[原本](../../agent/ADR/design-doc/0004-entry-stop-rule-pointer.md)
