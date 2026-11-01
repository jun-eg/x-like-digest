# ADR design-doc-0002: 6 節の△「IFTTT Free の Applet が実機で成立するか」が、成立すると分かって減った

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/design-doc.md — 6 節「埋まっていないこと（△）」
- **出典**: issue #44（親 #42）、技術の要件定義 9-8、利用者の実機の記録（2026-11-01）

## それまでの結論

IFTTT Free の「New liked tweet by you」から Webhook を送る Applet が成立するかは未検証の△で、成立しなければ入口の構成ごと変わるとしていた。

## 何が起きたか

利用者が Applet を作り、deploy した Worker A に実機で流した。トリガー「New liked tweet by you」とアクション「Make a web request」で組め、5 項目すべてに対応する Ingredient があった。いいね 3 件（非 IT 系 1、IT 系 2）のうち IT 系 2 件だけが本番 D1 に保存された。

## 新しい結論

△は確定した。入口の構成は変えない。制約が 1 つ分かった。Free のトリガー確認は 1 時間に 1 回で、いいねから D1 に届くまで最大 1 時間かかる。1 回の実行は 120 credits で、残りと補充周期は未確認。

## 影響

- 6 節の△を【確定】に書き換え、制約と、判定 1 の「1 行」が IT 系 2 件で 2 行になった点を記録した
- 確かめていないこと（IFTTT 自身の再送、credit の残りと補充周期）は残る
- Applet の Body の細部は技術の要件定義 4-1・9-8（ADR tech-requirements-0006）
