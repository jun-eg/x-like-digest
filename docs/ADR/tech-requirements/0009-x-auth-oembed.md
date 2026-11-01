---
source: agent/ADR/tech-requirements/0009-x-auth-oembed.md
source-hash: dece52bcc828311e809519bb99794ff05ee72763
---

# ADR tech-requirements-0009 の要約: X の認証情報の持ち方が仮のままで、最新の refresh token を D1 に置き、oEmbed は投稿者名だけに使う形で確定した

ADR tech-requirements-0007 が未確定で残した 9-11・9-12 を、利用者の手元の実機確認（2026-11-02）で確定した。0007 は取り消さない。
今は、client secret が要らないので Worker A の secret は `X_REFRESH_TOKEN`・`X_CLIENT_ID`・`X_USER_ID` の 3 本（利用者の決定。`vars` は公開リポジトリに載るため採らない）。`/2/users/me` は引かない。
refresh token は更新のたびに替わるので、最新の値は ingest だけに結ぶ認証用の D1 の `x_auth` に置き（B から読めない。KV は伝播が遅れるので採らない）、Secret は種にする。Secret を入れ直すと種から始め直す。新しい値は access token を使う前に書く。
書き込みは同じ回の中で書き直す。それでも失敗すると以後の更新が失敗し続けるが、認証が通らない記録を残すだけで止める印は立てず、手元のスクリプトで認可をやり直して Secret を入れ直して直す。
投稿者名は oEmbed の `author_url` の末尾で、投稿 ID だけで引ける。リンクは oEmbed には短縮 URL でしか出ないので、`liked_tweets` の `entities` から取る。外部リンクの実機は判定 1 の実機で見る。
[原本](../../agent/ADR/tech-requirements/0009-x-auth-oembed.md)
