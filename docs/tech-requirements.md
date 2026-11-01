---
source: agent/tech-requirements.md
source-hash: 3158c80dc7208c3dd65818467e7f9247a1b94bcc
---

# 技術の要件定義の要約: X いいね IT 情報デイリーダイジェスト

Design Doc の判断を、Cloudflare Workers 3 本と D1 で実装できる要件と、完了の測り方に翻訳した。
要件定義書はリポジトリに置かないので、受信 JSON、D1 の列、ジョブ状態、GitHub API の扱いの実体はこの文書が原本になる。

## 実行形態

- Workers Free 3 本（ingest、orchestrator、summarizer）、D1 Free 1 本、AI Gateway 経由の TypeSafe Jev（`typesafe/jev`、Cloudflare のクレジットで支払う）。常駐プロセスは無い
- 入口は ingest の Cron（毎時）が X の API で本人のいいねを新しい順に 5 件ずつ、前回の取得で上位にあった 5 件の投稿 ID に行き当たるまで取りに行く形で（最大 10 ページ。当たらなければ止める印を D1 に立てて定期の取得を止める。初回は覚えるだけ）、どの Worker にも公開ルートは無い。投稿者名は IT 系と判定した投稿だけ oEmbed で引き、リンクは取得した応答から取る。秘密は Worker ごとに 1 つずつ置き、2 つ以上持たせない（ingest は X の refresh token 1 つ。client secret は要らない。更新のたびに替わるので最新の値は D1 に置き、Secret は種にする）。ingest は加えて AI バインディングと D1、orchestrator は D1 と summarizer への Service Binding、summarizer はバインディング無し
- コードは 1 リポジトリに 3 つの wrangler プロジェクト。利用者本人が実装者なので開発者向けの道具を要求してよい。CLI は wrangler と `wrangler.jsonc` で、`cf` CLI は beta で secret 投入とログが未対応、dev と deploy も wrangler に委譲しているため採らない。beta が終わったら `cf migrate --dry-run` から見直す

## 規則

- IT 系の定義、「その日の投稿」は 18:00 JST までに受信した未処理の集合、ファイル名は処理日の JST 日付、同名ファイルは内容が違えば上書きしない、削除は当日バッチだけ、要約は 1 回だけで保存は翌日の本処理まで、0 件なら何もしない
- 境界値は 11 件を表にした。18:00 ちょうどは当日、Cron の遅れは 09:00 UTC で切る、取得済み（前回の上位 5 件に行き当たった位置以降。D1 の有無では決めない）は保存も判定もしない、再いいねでの再取り込みと、覚えた投稿の再いいねで間のいいねが落ちることは許す、Retry-After が期限を超えたら期限で最終試行、AI Gateway の残高切れ（`2021`）は判定失敗と同じで捨てる（通知は作らず、ダイジェストが届かないことで気づく。途中で尽きた日と 0 件の日は見分けがつかない）、前日分の未保存は翌日の本処理の先頭で処分する

## 仕様と選定

- 仕様は 29 行。入口の 1〜4 は、Cron だけで公開ルートが無いこと、X の認証の失敗、応答の検証、`tweet_url` の解析を見る。各行に「何を見れば満たしたと分かるか」と判定の手を付けた。権限分離の判定は 2 本で、設定にバインディングが無いこと（CI の `grep`）と、`wrangler secret list` の名前が 1 本だけであること（人が手元で。secret は設定ファイルに出ない）。作業の順序は、済んだ骨組み・CI・D1・deploy を作業 1 の実績とし、再 deploy と本番 D1 への適用を依存に持つ
- orchestrator の Cron は `*/10 * * * *` の 1 本で、期限切れの処分、再試行、本処理の順に行う（ingest の毎時と合わせて 2 本）。18:00 の発火が落ちても次の 10 分で拾える
- 次に試す時刻はジョブが持つ。1〜6 回目は開始 + 10 分 × 回数、7 回目以降は 60 分おき、期限は翌日 09:00 UTC
- GitHub の内容一致は Git blob SHA-1 を手元で計算して応答の sha と比べる
- 要約の形式検証は 4 つ。本文がある、見出し 4 本が順にある、空白を除いた文字数が 1,000〜1,300、本文中の X の URL がすべてバッチの投稿のもの
- 言語は TypeScript。Web フレームワークは入れない。公開する口が 1 本で、B は Cron、C は RPC で動くので、ルーティングもミドルウェアも要らない
- D1 は Drizzle で操作し、行の型はスキーマから出す。外から入る値は境界で zod で確かめ、型は z.infer から出す。as による読み替えは使わない。Service Binding は RPC、Claude は公式 SDK でツール無し、検査は vitest と Workers プール（`@cloudflare/vitest-plugin`。旧名の vitest-pool-workers は非推奨）

## 完了の測り方

- ステータスは Fixed。Design Doc のマイルストーン 5 段に、入力、数えるもの、合格の線、測る人を付けた。違反は 0 でなければ未達。権限分離の検査（5-25〜5-27・5-29）は、設定の `grep` の step と `wrangler secret list` を作業 10a、残りを作業 10b に合わせ、マイルストーン 5 で数える
- 自動テストは外部を差し替えて回数と状態を数える。実機は利用者本人が IT 系・非 IT 系のいいねと本処理 1 回で確かめる。入口が替わったので、判定 1 は X の API で測り直す。判定 5 には X の API の請求を足した
- 検査データは架空の本文で、post_id の桁、09:00 UTC の前後、バッチの内外、URL の形、文字数の境界を保つ

## 開いていること

- 値だけ未確定の項目が 5 件。Jev の閾値、1 バッチの入力上限、プロンプトの実体、CPU 10 ms に収まるか、Jev と Claude の実費。入口が替わって、X の API の実額、soft guarantee と料金の変動が増えた。「取得済み」の定義（件数 5 は実装者の判断。止まった後の再開は利用者が D1 の印を消す）と、X の認証情報の持ち方、oEmbed の引き方は確定した（外部リンクの `entities` の実機は判定 1 の実機で見る）。前の入口の実機の確定（9-8）は取り消した
- GitHub の保存先は `jun-eg/my-bias` の `main`、トークンは同リポジトリだけに限った Contents の書込（確定）。secret の名前は `X_REFRESH_TOKEN`（A）、`GITHUB_TOKEN`（B）、`ANTHROPIC_API_KEY`（C）。

## 根拠の在処

[原本](agent/tech-requirements.md)
