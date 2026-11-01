# ADR tech-requirements-0009: X の認証情報の持ち方が仮のままで、最新の refresh token を D1 に置き、oEmbed は投稿者名だけに使う形で 9-11・9-12 を確定した

- **Status**: 有効
- **Date**: 2026-11-02
- **対象**: docs/agent/tech-requirements.md — 2 の秘密の置き場・持ち物・セットアップ、4-1 の 2・4、4-2、5-2・5-3・5-29、8 の作業 3a・3・4、9-11・9-12
- **出典**: issue #65（親 #42）、[ADR tech-requirements-0007](0007-x-api-entry.md)、利用者の手元での実機確認（2026-11-02）

## それまでの結論

[ADR tech-requirements-0007](0007-x-api-entry.md) が入口を X の API に替えたとき、認証情報の持ち方と oEmbed の引き方を未確定として残していた。本 ADR がそれを確定に替える（0007 は取り消さない）。本文は次の形だった。

- 2 の秘密の置き場: Worker A の secret は `X_REFRESH_TOKEN`。「A の名前と数は仮で、refresh token が更新のたびに替わるか、client secret が要るかは 9-11 が決める」
- 5-29(b): 「本番の secret の名前が `X_REFRESH_TOKEN` の 1 本だけである（名前と数は 9-11 が決まるまで仮）」
- 9-11: 更新のたびに替わるなら最新の値は D1 に置く。client secret が要れば secret が 2 本になる。クライアント ID と user id を `vars` に置くか `/2/users/me` で引くか（課金が増えるか未確認）
- 9-12: 投稿 ID だけで oEmbed が引けるか、`first_url` は oEmbed の応答のどこから取るか、リンクの無い投稿は省くか
- 8 の作業 3 の依存は「2 と、9-11・9-12 の決定」で、それを決める作業が無かった。作業 4 に利用者の X Developer の用意が入っていた

## 何が起きたか

利用者が 2026-11-02 に手元で、Pay Per Use のプロジェクトの App（Native App）で認可コードフローと更新を計 4 回流し、`liked_tweets` と oEmbed を引いた。client secret は要らず、refresh token は毎回替わり、古い値の再使用は 400 になった。oEmbed は投稿 ID だけで引けたが、本文中のリンクは t.co の短縮 URL としてしか出なかった。

## 新しい結論

- secret は Worker A の `X_REFRESH_TOKEN` 1 本のまま（client secret は要らない）。クライアント ID と user id は `vars`（`X_CLIENT_ID`、`X_USER_ID`）。`/2/users/me` は引かない
- 最新の refresh token は D1 の `x_auth` に置く。Secret は種で、`seed_hash` が今の Secret の hash と違えば Secret の値から始める。更新で得た新しい値は access token を使う前に書く。access token は保存せず毎回更新する
- 書き込みに失敗すると以後の更新が 400 で失敗し続けるが、止める印は立てない（課金が無く、直すのは Secret の入れ替えだけ）。通知は作らない
- `author` は oEmbed の `author_url` の末尾（投稿 ID だけで引ける）。`first_url` は oEmbed ではなく `liked_tweets` の `entities.urls[].expanded_url` から取り、`pic.twitter.com`・`x.com`・`twitter.com` のリンクは除く
- 実装者の判断は、D1 に置くこと、Secret を種にして `seed_hash` で入れ直しを見分けること、access token を保存しないこと、止める印を立てないこと、`vars` に置くこと、`first_url` の取り方。実機で分かったことは、client secret が要らないこと、refresh token が毎回替わること、oEmbed が投稿 ID だけで引けること、`first_url` に使えないこと

## 影響

- 9-11・9-12 を確定行にし、「9-11 の確定内容」「9-12 の確定内容」を足した（実機で分かったことと実装者の判断、まだ確かめていないこと）
- 2 の秘密の置き場・持ち物・セットアップ、4-1 の 2・4 と本文、5-2（検査に `x_auth` の順序と書き込み失敗、Secret の入れ替えを足した）、5-3（トークン更新も止める印で止まること、`first_url` の取り方と検査 (h)）、5-29(b) の「仮」を外した
- 4-2 に `x_auth`（`refresh_token`、`seed_hash`、`updated_at`）を足した。5-8 の確定と 5-19 の削除は触らない
- 8 に作業 3a（この決定。#65）を足し、作業 3 の依存を「2、3a」に、作業 4 から利用者の X Developer の用意を外した
- まだ実機で確かめていないこと: 外部リンクを含む投稿の `entities.urls`（判定 1 の実機 #66 で見る）、refresh token の有効期限、更新の応答が失われたときの新旧の有効性、oEmbed の回数制限
- コードは変えていない。`x_auth` の実装と最初の refresh token を得る手の置き場は #43 が決める
