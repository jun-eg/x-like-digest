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
- 9-8: 【確定 2026-11-01】IFTTT の Ingredient のエスケープ挙動と、Webhook の応答制限 12 秒。「9-8 の確定内容」は次のとおりだった。利用者が IFTTT Free の Applet を作り、deploy した Worker A（`https://x-like-digest-ingest.negima.workers.dev/webhooks/x-like`）に実機で流して確かめた
  - エスケープ。Body を `{"text":"{{Text}}",...}` にすると、改行を 2 つ含む投稿（18:34）が 400 になった。ログに理由が出ないので応答の種類は直接見ていないが、他の項目は検査を通る値だったので invalid_json と判断した。`"text":"<<<{{Text}}>>>"` に変えると、改行を含む IT 系 2 件が保存され、D1 の text に改行が残った（`instr(text, char(10)) > 0` が 2 件とも 1）。IFTTT の Body 欄の説明は「Surround any text with <<< and >>> to escape the content (ex. to preserve line breaks).」
  - 12 秒。19:34 の実行は IFTTT の activity で「Action ran」になり、時間切れにならなかった。所要時間そのものは測っていない
  - Ingredient。「New liked tweet by you」には Text・UserName・LinkToTweet・FirstLinkUrl・CreatedAt があり、4-1 の 5 項目すべてに対応する。「New link by you」では `{{FirstLinkUrl}}` が Unrecognized ingredient だった。最初にトリガーをこれと付け間違え、17:50 に 1 件 400 を出した
  - 判定 1。19:34 の確認でいいね 3 件がまとめて届いた。非 IT 系 1 件は 200 で保存されず、IT 系 2 件（`2116702728760205628`、`2116778869080691022`）が保存され、本番 D1 の `posts` は 2 行になった。7 節の判定 1 の線（行数が流した IT 系の件数と一致、非 IT 系は 0 行、2 回目で増えない）を満たした
  - 重複。IFTTT の再いいねは起こさず、curl で正しい secret を付けて保存済みと同じ tweet_url を POST すると 200 `{"status":"duplicate"}` で、`posts` は 2 行のまま。IFTTT の再送そのものは確かめていない
  - Free の制約。トリガーの確認は 1 時間に 1 回（Starter は 15 分、それ以上は 5 分）。溜まったいいねはまとめて届き、activity には最後の 1 件しか見えないことがある。1 回の実行で 120 credits（トリガー 100、アクション 20）。残りの credit と補充周期は未確認
  - 確かめていないこと。(a) リンクの無い投稿で `FirstLinkUrl` が空文字になり `first_url: ""` が zod の `url()` で 400 になるか（流していない。扱いは決めていない）。(b) 400 の理由がログに出ない点（#50 の範囲）
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
- 9-8 は取り消す。エスケープ挙動と応答制限 12 秒は、受ける口が無くなって当てはまらない。確かだった事実（IFTTT の Applet が組めたこと、判定 1 を IT 系 2 件で満たしたこと）は、ADR design-doc-0002 とこの ADR の「それまでの結論」に残る。投稿 ID・経過・Free の制約を含む 9-8 の記録は、上の「それまでの結論」に写してある
- 新しい△を 9-9〜9-13 に置いた。X の API の実額、soft guarantee と料金の変動、X の認証情報の持ち方（refresh token の更新、client secret、secret の数）、oEmbed の引き方、「取得済み」の持ち方

## 影響

- 入力元の対応表、1 節の引き受ける範囲とスコープ外の引用、2 節（実行環境・公開面・秘密・持ち物・セットアップ・経路）、3 節（規則 2・境界値の 4 行）、4-1・4-2、5 節（1〜4・5〜7・29・残高切れ）、6 節（1・4・8・11・13）、7 節（判定 1・5）、8 節（作業 2〜4・11）、9 節（8〜13）を書き直した。9-8 の確定内容の節は外した
- コードは変えていない。ingest の `IFTTT_SECRET` と Webhook の受け口は、#42 の配下（#60）で直す。それまで文書とコードは食い違う
- 5-29 の「Worker A の secret は 1 本」は、9-11 が決まるまで仮。client secret が要れば 2 本になり、2 節・5-29 を直す
- 9-13 は「取得済み」の定義で、(a) 非 IT 系の毎時の再判定、(b) 5-19 の削除後に保存済み投稿が判定し直されて翌日に重複すること、(c) D1 が空の初回に次のページの取得が止まる場所、の 3 つを含む。人の決定で、「次のページ」を 1 ページで止めるか繰り返すかを変えるときだけ Design Doc 6「入口」に返す
