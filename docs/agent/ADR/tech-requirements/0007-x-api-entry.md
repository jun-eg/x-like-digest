# ADR tech-requirements-0007: 入口が IFTTT から X の API で取りに行く形に替わり、IFTTT を前提にした仕様と 9-8 の実機の結論を取り消した

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/tech-requirements.md — 入力元の対応表、1、2、3、4-1・4-2、5 の 1〜4・6・7・29 と残高切れ、6 の 1・4・8・11・13、7 の判定 1・5、8 の作業 2〜4・11、9 の 7〜13
- **出典**: issue #59（親 #57）、[ADR design-doc-0003](../design-doc/0003-x-api-pull-entry.md)、利用者の判断（2026-11-01）

## それまでの結論

[ADR tech-requirements-0006](0006-ifttt-real-device.md) が、IFTTT の実機確認で 9-8 を確定し、7 節の判定 1 の線と 4-1 を次のようにしていた。本 ADR がそれを上書きする。

- 4-1: IFTTT の Applet は、トリガー X（Twitter）の「New liked tweet by you」、アクション Webhooks の「Make a web request」で作る（POST、Content Type `application/json`、Additional Headers に `Authorization: Bearer <IFTTT_SECRET>`）。Body は本文を `<<<` と `>>>` で囲み、次の形にする。

  ```
  {"text":"<<<{{Text}}>>>","author":"{{UserName}}","tweet_url":"{{LinkToTweet}}","first_url":"{{FirstLinkUrl}}","created_at":"{{CreatedAt}}"}
  ```

  `CreatedAt` は ISO ではなく `October 31, 2026 at 06:51PM` の形で届く
- 9-8: 【確定 2026-11-01】IFTTT の Ingredient のエスケープ挙動と、Webhook の応答制限 12 秒。本文を `<<<` `>>>` で囲まないと改行を含む投稿が 400 になる。12 秒には収まった。いいね 3 件（非 IT 系 1、IT 系 2）のうち IT 系 2 件が `posts` に 2 行で入り、curl で同じ `tweet_url` を送ると 200 `{"status":"duplicate"}`。「New link by you」には `FirstLinkUrl` が無い。確かめていないのは、リンクの無い投稿の `first_url: ""` と、IFTTT 自身の再送
- 7 節の判定 1: 「IFTTT から Worker A に届き、IT 系だけが D1 に重複なく溜まる」。実機の線は「行数が流した IT 系の件数と一致、非 IT 系は 0 行、2 回目で増えない」
- 2 節: 公開面は Worker A の `POST /webhooks/x-like` だけ。Worker A の secret は IFTTT の共有シークレット `IFTTT_SECRET`
- 3 節: 同じ `post_id` は 2 回目以降を保存せず 2xx を返す。IFTTT の再送を想定する。Jev の失敗と残高切れは捨てて 2xx を返し、再送を求めない
- 5 節の 1〜4: 公開 Webhook 1 本、共有シークレットで認証、Content-Type・16 KiB・JSON の形で 415・413・400、`tweet_url` の厳密な解析
- 5 節の残高切れの却下案: 「`2021` のときだけ 5xx を返し、IFTTT の再送に任せる」

## 何が起きたか

[ADR design-doc-0003](../design-doc/0003-x-api-pull-entry.md) が、入口を IFTTT Free から、Worker A が X の API で自分のいいねを 1 時間おきに取りに行く形に替えた（IFTTT Free は 1 回の実行で 120 credits かかり、無料枠では月 8 件分しか流せない）。技術の要件定義の IFTTT を前提にした所が、新しい Design Doc と食い違った。

## 新しい結論

- 入口は Worker A の Cron（`0 * * * *`）。X の API の `liked_tweets` を `max_results=5` で取り、5 件とも未取得なら次のページも取る。投稿者名とリンクは Jev が IT 系と判定した投稿だけ oEmbed で引く。認証は OAuth 2.0 の refresh token で、Worker A の secret は X の認証情報（名前は仮に `X_REFRESH_TOKEN`）
- 公開面はどの Worker にも無い。受信 JSON の HTTP の検査（Content-Type、16 KiB、想定外フィールド、共有シークレット）は無くなり、代わりに 5-1〜5-4 を、Cron だけであること、トークン更新の失敗、X の API と oEmbed の応答の検証、`tweet_url` の厳密な解析に書き直した
- 4-1 の 5 項目は変えず、出どころを X の API と oEmbed に替えた。`created_at` は X の API の ISO 8601 になる
- 3 節と 5-6・5-7 は、再送を受ける形から、取得した投稿を D1 に既にあれば保存せず Jev も呼ばない形に替えた。Jev の失敗と残高切れは、その投稿を捨ててその回の残りを続ける
- 7 節の判定 1 は、IFTTT で満たしたものを取り消し、X の API で取り込んだ形で測り直す。線は同じで、取り込みが 1 時間おきでまとまって取る点も同じ。判定 5 には X の API の請求を足した
- 6 節は、Cron を 2 本にし（無料枠 5 本に 3 本残る）、公開する口が無い前提で Hono の行を直し、検査の差し替え先と zod の境界に X の API と oEmbed を足した
- 9-8 は取り消す。エスケープ挙動と応答制限 12 秒は、受ける口が無くなって当てはまらない。確かだった事実（IFTTT の Applet が組めたこと、判定 1 を IT 系 2 件で満たしたこと）は、ADR design-doc-0002 とこの ADR の「それまでの結論」に残る。0006 の記録はそのまま読める
- 新しい△を 9-9〜9-13 に置いた。X の API の実額、soft guarantee と料金の変動、X の認証情報の持ち方（refresh token の更新、client secret、secret の数）、oEmbed の引き方、「取得済み」の持ち方

## 影響

- 入力元の対応表、1 節の引き受ける範囲とスコープ外の引用、2 節（実行環境・公開面・秘密・持ち物・セットアップ・経路）、3 節（規則 2・境界値の 4 行）、4-1・4-2、5 節（1〜4・5〜7・29・残高切れ）、6 節（1・4・8・11・13）、7 節（判定 1・5）、8 節（作業 2〜4・11）、9 節（8〜13）を書き直した。9-8 の確定内容の節は外した
- コードは変えていない。ingest の `IFTTT_SECRET` と Webhook の受け口は、#42 の配下（#60）で直す。それまで文書とコードは食い違う
- 5-29 の「Worker A の secret は 1 本」は、9-11 が決まるまで仮。client secret が要れば 2 本になり、2 節・5-29 を直す
- 9-13 は Design Doc 6「入口」の「5 件とも未取得なら」の読み方に関わる。人の決定で上流を直すことがありうる
