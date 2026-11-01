# ADR tech-requirements-0003: GitHub の保存先とトークンの範囲を決め、secret の名前と workers.dev サブドメインの前提を足した

- **Status**: 有効
- **Date**: 2026-11-01
- **対象**: docs/agent/tech-requirements.md — 2 節（秘密の置き場、セットアップに要求するもの）、9 節 6 件目
- **出典**: issue #17、人の決定（2026-11-01）

## それまでの結論

9 節 6 件目は「GitHub の保存先 `owner/repo`、ブランチ、トークンの発行方式」が △（何が分かれば決まるか: 利用者が導入時に決める）。
2 節の「秘密の置き場」は secret の名前を持たず、「セットアップに要求するもの」に `workers.dev` サブドメインの登録が無かった。

## 何が起きたか

3 Worker を deploy して secret を入れる段になり、保存先と名前を決める必要が出た。人が保存先とトークンの範囲を決めた。
ingest が `workers.dev` で公開されるので、Cloudflare アカウントにサブドメインの登録が要ると分かった。登録はダッシュボードでする。CLI だけではできない。

## 新しい結論

- 保存先は `jun-eg/my-bias`（非公開、既定ブランチ `main`）、保存するブランチも `main`
- トークンは fine-grained personal access token。対象を `jun-eg/my-bias` だけに限り、権限は Contents の Read and write
- secret の名前は ingest が `IFTTT_SECRET`、orchestrator が `GITHUB_TOKEN`、summarizer が `ANTHROPIC_API_KEY`
- セットアップに `workers.dev` サブドメインの登録を要求する。未登録だと deploy が通らない
- 9 節 6 件目は △ から確定にした。△ は 7 件から 6 件になった

## 影響

- 2 節の「秘密の置き場」に名前を、「セットアップに要求するもの」にサブドメインを足した
- 9 節 6 件目を確定にし、「9-6 の確定内容」を足した。要約の △ の件数も直した
- 値を埋めただけで、既存の決定は覆していない
- 3 Worker は deploy 済みで、secret は 1 Worker に 1 本ずつ入っている（`wrangler secret list` で確認）。本番 D1 へのスキーマ適用は人が手元で行う
