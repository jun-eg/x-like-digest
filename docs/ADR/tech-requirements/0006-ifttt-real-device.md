---
source: agent/ADR/tech-requirements/0006-ifttt-real-device.md
source-hash: 36e5b48510fcac15adcb5b4c9f3d960c184b1c34
---

# ADR tech-requirements-0006 の要約: 9-8 を実機で確定した（取り消し）

ADR tech-requirements-0007 が上書きした。入口が IFTTT から X の API で取りに行く形に替わり、9-8 の「本文を `<<<` `>>>` で囲む」「12 秒に収まった」は、受ける口が無くなって当てはまらなくなった。

生きているのは実機の事実だけ。IFTTT の Applet は組め、改行を含む投稿は本文を囲むと壊れず保存され、IT 系 2 件が 2 行で入って判定 1 の線を満たした。この記録は 0006 と 0007 の「それまでの結論」から読める。
判定 1 は X の API で取り込んだ形で測り直す。未確認だった IFTTT 自身の再送は、再送を受けない入口になって意味を失った。

[原本](../../agent/ADR/tech-requirements/0006-ifttt-real-device.md)
