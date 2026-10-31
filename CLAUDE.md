# CLAUDE.md — 始める前にしか踏めない手

**ここにあるのは、作業を「始める前」に踏まないと、後から戻れなくなる手だけである。**
**実行前に止める柵は [`.claude/README.md`](.claude/README.md)、成果物の書き方は [`docs/agent/ADR/README.md`](docs/agent/ADR/README.md) と
[`.claude/skills/`](.claude/skills/)、人が読む要約・issue・PR 本文の書き方は [`docs/README.md`](docs/README.md) が持つ。ここには写さない**（**二重に持つと片方が古くなる**）。

## 実装を始めるとき

**次の 2 手を、この順で踏む。**

### 1. `main` を最新にする

```
git switch main && git pull
```

### 2. worktree を切り、その中で作業する

**Claude に「worktree を切って」と頼む**（Claude Code の worktree 機能）。
**`.claude/worktrees/<名前>` に新しいブランチで作られ、セッションがそこへ移る。**

- **名前は `<issue 番号>-<slug>`**（例: `170-claude-md`）。**ブランチ名は `worktree-` の付いた形になる**（`worktree-170-claude-md`）。
  **番号が入っていれば、PR からも merge コミットからも issue に戻れる**
- **名前に `/` を入れない。** **ディレクトリが 1 段深くなり、ブランチ名では `+` に化ける**（`docs/170-x` → `worktree-docs+170-x`）
- **切ったら `git log -1` で分岐元を見る。** 分岐元は**手元の `origin/main`**（設定 `worktree.baseRef` の既定値 `fresh`）なので、
  **1 を飛ばすと古いところから切れる**

## なぜ 2 手が要るのか

**分岐元は、始めた後では直せない。** **force-push も push 済みの rebase も止めてある**ので
（[`.claude/README.md`](.claude/README.md) ／ [issue #73](https://github.com/jun-eg/school-festival-shift/issues/73)）、
**古い `main` や 1 本前のブランチの上に積んでしまったら、ブランチを作り直すしかない。**

**worktree を切れば、メインの作業ツリーは `main` のまま残る。** **途中で `main` の中身を見に行くのに、手元の変更を退避しなくてよい。**

**Claude Code の worktree 機能は、人がその場で頼むか、この `CLAUDE.md` のような指示があるときにしか使われない。**
**毎回口で言うのをやめるために、ここに書いてある。**

## Cloudflare の CLI

**Cloudflare の CLI は wrangler を使う。`cf` は beta が明けるまで使わない**（理由は [`docs/agent/tech-requirements.md`](docs/agent/tech-requirements.md) の選定表）。
`wrangler` skill は `wrangler.jsonc` が無いうちは `cf` へ誘導するが、従わない。
