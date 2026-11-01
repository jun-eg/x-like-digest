---
source: agent/ADR/tech-requirements/0004-ai-gateway-credits-exhausted.md
source-hash: afc4407935bb23c9b1abd6c175110d28a32788a0
---

# ADR tech-requirements-0004 の要約: AI Gateway の残高切れを「判定失敗は捨てる」に含めた

AI Gateway は前払いで、残高が尽きると Jev が `2021: Insufficient AI Gateway credits` を返す。その間のいいねの扱いと気づく手が決まっていなかった。

今は 5-6 の「判定失敗」と同じで、D1 に書かず 2xx を返し、再送を求めない。通知は作らず、その日のダイジェストが届かないことで気づく。
日の途中で尽きた日は捨てた件数が分からず、いいね 0 件の日とも見分けがつかない。保留、5xx での再送、Cloudflare の通知、メール、GitHub への注記は採らなかった。

[原本](../../agent/ADR/tech-requirements/0004-ai-gateway-credits-exhausted.md)
