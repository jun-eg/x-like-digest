---
source: agent/ADR/design-doc/0003-x-api-pull-entry.md
source-hash: bd09fcec5ff9a21a06725021f67efafaf1f9c484
---

# ADR design-doc-0003 の要約: 入口の IFTTT Free が credit の量で崩れ、X の API で取りに行く形に替えた

IFTTT Free は 1 回の実行で 120 credits かかり、無料枠では月 8 件分しか流せなかった。利用者が IFTTT をやめると決め、代替 3 案のうち「いいねを押すだけ」を守る X の API 案を採った。ADR design-doc-0002 を上書きする。

今の入口は、Worker A が X の API で自分のいいねを 1 時間おきに最新 5 件ずつ取りに行き、投稿者名は無認証の oEmbed で引く。費用は変動費で、1 日 2〜10 件なら月 32〜68 円、17 件で 100 円の線。固定費 $0 は保つ。Design Doc 1・5・6・7 を書き換え、技術の要件定義は #59、コードは #60 に送った。

[原本](../../agent/ADR/design-doc/0003-x-api-pull-entry.md)
