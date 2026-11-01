# scripts — repo の文書を見る手の置き場

**ここにあるのは、repo の文書を読んで、約束どおりかを見る手である。** 実装ではない。
**どれも Node の標準だけで動き、依存はゼロである。** commit の前（[`.githooks/pre-commit`](../.githooks/pre-commit)）と
PR（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)）で同じものが回る。

## リンクの検査

```
node scripts/リンクの検査.mjs
```

**データではなく、repo の Markdown を見る手である。** 全 `.md` のリンク記法と `<img>` の `src` にある相対パスが、
実在するファイルに解決するかを見る。`http(s)://` と `mailto:` とページ内の `#` と、` ``` ` の中の例文と、
`<立場>.md` のような雛形の穴は見ない。**何も書き換えない。読むだけである。**
全件解決なら終了コード 0、1 つでも外れたら **ファイル名・行・リンク先を並べて 1 で落ちる。**
起こした経緯は [school-festival-shift#313](https://github.com/jun-eg/school-festival-shift/issues/313)（`docs/` を `docs/agent/` へ動かし、約 400 箇所が一度に動いた）。

## 要約の検査

```
node scripts/要約の検査.mjs            # 作業ツリーの原本と比べる（pre-commit）
node scripts/要約の検査.mjs --head     # HEAD の原本と比べる（CI）
node scripts/要約の検査.mjs --stamp docs/design-doc.md   # 見直した要約のハッシュを刻み直す
```

**これもデータではなく、repo の文書を見る手である。** `docs/` 直下の要約の先頭にある `source-hash` と、原本（`docs/agent/`）の
`git hash-object`（フォルダはツリーハッシュ）を比べ、**違えば要約の名前を挙げて 1 で落ちる。**
要約の長さの上限（成果物 40 行・ADR 1 本 10 行）も同時に見る。**規約の原本と止まったときの直し方は [`docs/README.md`](../docs/README.md)。**
`--stamp` 以外は何も書き換えない。起こした経緯は [school-festival-shift#316](https://github.com/jun-eg/school-festival-shift/issues/316)。

## 秘密の検査

```
node scripts/秘密の検査.mjs      # ステージされた物を見る（pre-commit）
```

**これは repo の文書ではなく、commit しようとしている物を見る手である。** ステージされた物の**名前**（`.env` ・ `.dev.vars` ・ `creds.json` ・ `client_secret*.json` など）と**中身**
（GitHub・AWS・Anthropic・Google のトークンや鍵の形、秘密鍵、手元の `.env` と `.dev.vars` に書いた値そのもの）を見て、当たれば**ファイル名だけを挙げて**（値は出さない）1 で落ちる。
`.gitignore` は `git add -f` で破れるので、ここでも止める。**検査は [`秘密の検査.test.mjs`](秘密の検査.test.mjs)**（`node --test "scripts/**/*.test.mjs"`。CI の job `hooks` が回す）。
起こした経緯は [school-festival-shift#307](https://github.com/jun-eg/school-festival-shift/issues/307)（E2E の鍵と ID を手元に置くことになった）。

## 最初の refresh token の取得

```
X_CLIENT_ID=<クライアント ID> node scripts/X認可フロー.mjs
```

**これは検査ではなく、Worker A の Secret `X_REFRESH_TOKEN` を入れる手元の手である。** 認可コードフロー（PKCE、client secret 無し）を loopback で受けて交換し、
refresh token を `wrangler secret put X_REFRESH_TOKEN --name x-like-digest-ingest` の標準入力に渡す。**トークンは標準出力にもファイルにも出さない。**
認証が通らなくなったときの入れ直し（技術の要件定義 9-11）も同じ手で行う。`X_CLIENT_ID` と `X_USER_ID` の Secret は手で入れる。**検査は [`X認可フロー.test.mjs`](X認可フロー.test.mjs)。**
