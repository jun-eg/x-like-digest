---
source: agent/ADR/design-doc/0002-ifttt-applet-works.md
source-hash: 529ffbbfd558a4c2383eae23677d9cf40628731c
---

# ADR design-doc-0002 の要約: IFTTT Free の Applet が実機で成立すると分かった

Design Doc 6 節は、IFTTT Free の Applet が成立するかを未検証にしていた。実機で「New liked tweet by you」から Webhook を送る Applet が組め、いいね 3 件のうち IT 系 2 件だけが D1 に保存された。

入口の構成は変えない。制約は、Free のトリガー確認が 1 時間に 1 回で、いいねから届くまで最大 1 時間かかること。credit の残りと補充周期は未確認。

[原本](../../agent/ADR/design-doc/0002-ifttt-applet-works.md)
