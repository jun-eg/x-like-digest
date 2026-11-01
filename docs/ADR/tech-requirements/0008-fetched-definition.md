---
source: agent/ADR/tech-requirements/0008-fetched-definition.md
source-hash: c89e007aa13f2952f21de02df5d112cca2fd2e2f
---

# ADR tech-requirements-0008 の要約: 「取得済み」を D1 の有無で決められず、前回の上位 5 件の投稿 ID に行き当たるまでめくる形で確定した

ADR tech-requirements-0007 が未確定で残した 9-13 を確定した。0007 は取り消さない。

今は、Worker A が前回の取得で最初に返った 5 件の投稿 ID を D1 の `seen_likes` に覚え、新しい順に 5 件ずつめくって行き当たったら止める。ページは最大 3、初回は 1 ページ。覚える件数 5 は 1 ページ分で追加の読み出しが無いため、上限 3 は 1 時間 15 件までを拾い最悪の追加課金を約 1.5 円に抑えるため。
再いいねでの再取り込みと、捨てた投稿が取り直されないことは許す。Design Doc の入口の文は初回だけ字義と食い違うので、返すかは人が決める。コードは #60 で直す。

[原本](../../agent/ADR/tech-requirements/0008-fetched-definition.md)
