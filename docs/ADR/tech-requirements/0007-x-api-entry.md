---
source: agent/ADR/tech-requirements/0007-x-api-entry.md
source-hash: d2dd45f4854539c5ddc5f14d5c303d792721f771
---

# ADR tech-requirements-0007 の要約: 入口が X の API で取りに行く形に替わり、IFTTT を前提にした仕様を取り消した

ADR design-doc-0003 で入口が IFTTT Free から X の API に替わり、技術の要件定義の IFTTT 前提の所が食い違った。ADR tech-requirements-0006 を上書きする。

今は、Worker A が Cron（毎時）で本人のいいねを最新 5 件ずつ取り、IT 系と判定した投稿だけ oEmbed で投稿者名を引く。どの Worker にも公開ルートは無く、Webhook の受信の検査は取り込みの検査に替わった。判定 1 は X の API で測り直し、判定 5 に X の API の請求を足した。9-8 は取り消した。
新しい未確定を 5 件置いた。X の API の実額、soft guarantee と料金の変動、認証情報の持ち方（secret の数は仮）、oEmbed の引き方、「取得済み」の定義（非 IT 系の再判定、削除後の翌日の重複、空の初回の次ページ）。コードは #60 で直すので、それまで ingest の `IFTTT_SECRET` と文書は食い違う。

[原本](../../agent/ADR/tech-requirements/0007-x-api-entry.md)
