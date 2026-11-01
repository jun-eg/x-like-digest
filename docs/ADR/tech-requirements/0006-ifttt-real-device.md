---
source: agent/ADR/tech-requirements/0006-ifttt-real-device.md
source-hash: dd01ed175443b4943dc10526885f81459b25bbe5
---

# ADR tech-requirements-0006 の要約: 9-8 を実機で確定した

IFTTT の Body に本文をそのまま差すと、改行を含む投稿で JSON が壊れて 400 になった。本文を `<<<` と `>>>` で囲むと改行が残ったまま保存された。応答の 12 秒には収まった。

判定 1 の線は「1 行」から「行数が流した IT 系の件数と一致、非 IT 系は 0 行、2 回目で増えない」に直した（Free はまとめて届くため）。実機は IT 系 2 件 = 2 行で合格した。
未確認は、リンクの無い投稿の空の `first_url`、400 の理由がログに出ないこと、IFTTT 自身の再送。Body の全文は技術の要件定義 4-1。

[原本](../../agent/ADR/tech-requirements/0006-ifttt-real-device.md)
