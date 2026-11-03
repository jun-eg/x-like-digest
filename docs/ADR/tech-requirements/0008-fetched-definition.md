---
source: agent/ADR/tech-requirements/0008-fetched-definition.md
source-hash: 416191a8ba7884cc952533fb8c65b4053813eda9
---

# ADR tech-requirements-0008 の要約: 「取得済み」を D1 の有無で決められず、前回の上位 5 件の投稿 ID に行き当たるまでめくる形で確定した

ADR tech-requirements-0007 が未確定で残した 9-13 を確定した。0007 は取り消さない。

今は、Worker A が前回の取得で最初に返った 5 件の投稿 ID を D1 の `seen_likes` に覚え、新しい順に 5 件ずつめくって行き当たったら止める。ページは最大 10 で、当たらなければ 50 件を扱わず、止める印を D1 に立てて定期の取得を止める。再開は利用者が印と覚えを消す。初回は覚えるだけで取り込まない。覚えの置き換えは全部扱い終えた後で、途中の失敗は次の回が取り直し、UTC の日付をまたいだら同じく止める。
再いいねでの再取り込みや、覚えた投稿の再いいねで間のいいねが落ちることは許す。Design Doc の入口には 9-13 を指す一言を足した。コードは #60 で直す。

[原本](../../agent/ADR/tech-requirements/0008-fetched-definition.md)
