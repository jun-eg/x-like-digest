---
source: agent/ADR/tech-requirements/0009-x-auth-oembed.md
source-hash: 582344e8b579f56decb003d9932a979a4d6fbde3
---

# ADR tech-requirements-0009 の要約: X の認証情報の持ち方が仮のままで、最新の refresh token を D1 に置き、oEmbed は投稿者名だけに使う形で確定した

ADR tech-requirements-0007 が未確定で残した 9-11・9-12 を、利用者の手元の実機確認（2026-11-02）で確定した。0007 は取り消さない。
今は、client secret が要らないので Worker A の secret は `X_REFRESH_TOKEN` 1 本のまま。クライアント ID と user id は `vars` に置き、`/2/users/me` は引かない。
refresh token は更新のたびに替わるので、最新の値は D1 の `x_auth` に置き、Secret は種にする。Secret を入れ直すと種から始め直す。新しい値は access token を使う前に書く。
書き込みに失敗すると以後の更新が失敗し続けるが、止める印は立てず、Secret の入れ替えで直す。
投稿者名は oEmbed の `author_url` の末尾で、投稿 ID だけで引ける。リンクは oEmbed には短縮 URL でしか出ないので、`liked_tweets` の `entities` から取る。外部リンクの実機は判定 1 の実機で見る。
[原本](../../agent/ADR/tech-requirements/0009-x-auth-oembed.md)
