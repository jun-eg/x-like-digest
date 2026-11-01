# 開発する人へ

**ここは入口である。** この基盤が何を持っているかは [`README.md`](README.md) が持つ。

## 何を作っているかは `docs/` の要約を読む

**ジャーニーマップ・HMW・Design Doc・技術の要件定義・ADR の要約は、[`docs/README.md`](docs/README.md) の一覧から辿る。**
**要約は原本（`docs/agent/`）から Claude が書いたもので、手で直さない。** 原本へは要約の先頭のリンクで 1 クリックで行ける。

## commit の前に回る検査を有効にする

**clone したら 1 回だけ**、git hooks の置き場をリポジトリの中に向ける。

```
git config core.hooksPath .githooks
npm ci
```

**`npm ci` で依存を入れておく。** 入っていないと pre-commit の `npm run check` が `biome: not found` で止まる。

**これで commit のたびに [`.githooks/pre-commit`](.githooks/pre-commit) が走り、落ちる状態の commit は止まる**
（何を回すかは hook を読む。中身は [`scripts/README.md`](scripts/README.md)）。**同じ検査が PR でも回る**（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。
**止まったときの直し方は [`docs/README.md`](docs/README.md) の「古さの check」。**
**トークン・鍵・`.env` は commit しない。** `.gitignore` が名指しし、pre-commit の `秘密の検査` が中身を止める。

**同じ設定で `git push` の前に [`.githooks/pre-push`](.githooks/pre-push) も走る。** 検査ファイル・検査を弱める設定（`package.json` の test 系 script、`ci.yml`）に差分が無い push は、何も呼ばずに通る（1 秒未満）。
差分があるときだけ `claude -p --agent test-diff-reviewer` が差分を読み、検査を消す・緩める変更に根拠（同じ push の実装の変更、issue の「決めたこと」）が無ければ止める。
**`claude`（Claude Code）が PATH に要る。** 無ければ入れ方を出して止まる。**人が承知で抜けるのは `git push --no-verify` だけ**（Claude には [`guard-bash`](.claude/README.md) が打たせない）。CI では回さない。

## merge 後の branch を自動で消す設定を on にする

**template から作ったリポジトリは off から始まる。使い始めに 1 回だけ on にする。**
GitHub のリポジトリの **Settings → General → Pull Requests** の **「Automatically delete head branches」** にチェックを入れる
（REST では `delete_branch_on_merge`。`gh api repos/<owner>/<repo> --jq .delete_branch_on_merge` が `true` なら済んでいる）。
**PR を merge すると、その head の remote branch が消える。** **Claude が remote の branch を消す主な形は [`guard-bash`](.claude/README.md) が止める**（拾えない形は README に列挙）ので、削除はこの設定が担う。
local の branch と worktree は消えない。

## 揃えてあるもの

**Node は [`.node-version`](.node-version) の版を使う**（検査の手と CI が同じ版で回る）。
**Dependabot が月 1 で、GitHub Actions と npm の更新 PR を種類ごとに 1 本ずつ作る**（[`.github/dependabot.yml`](.github/dependabot.yml)）。
**[`.editorconfig`](.editorconfig) が改行・字下げ（space・2）・文字コードを揃え、[`.vscode/extensions.json`](.vscode/extensions.json) が EditorConfig の拡張を勧める。**
