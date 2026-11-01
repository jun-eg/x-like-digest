---
source: agent/ADR/tech-requirements/0006-ifttt-real-device.md
source-hash: 6ac43f5924fb337cc0c82d154fc484688f4323b0
---

# ADR tech-requirements-0006 の要約: 9-8 を実機で確定した

IFTTT の Body に本文をそのまま差すと、改行を含む投稿で JSON が壊れて 400 になった。本文を `<<<` と `>>>` で囲むと改行が残ったまま保存された。応答の 12 秒には収まった。

判定 1 は IT 系が 2 件届いて 2 行になったが、IT 系だけが重複なく溜まることは満たした。
未確認は、リンクの無い投稿の空の `first_url`、400 の理由がログに出ないこと、IFTTT 自身の再送。Body の全文は技術の要件定義 4-1。

[原本](../../agent/ADR/tech-requirements/0006-ifttt-real-device.md)
