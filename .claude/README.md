# .claude — 事故を実行前に止める柵の置き場

**ここにあるのは、作業の事故を「実行される前に」止める仕掛けである。** 読んで守る文章ではない。
**成果物の書き方の規約は混ぜない。** それは [`docs/agent/ADR/README.md`](../docs/agent/ADR/README.md) と [`skills/`](skills/) が持つ。
**[`agents/`](agents/) は subagent の定義で、使い方は対になる段取り（[`skills/flow/`](skills/flow/)）が持つ。** きっかけから引く索引は次の表（段取りの中身はここに写さない）。`agents/test-diff-reviewer.md` は段取りでなく `.githooks/pre-push` が呼ぶ。

| きっかけ | 呼ぶ段取り（`skills/flow/`） | 回る agent |
| --- | --- | --- |
| issue を実装する | `/flow implement`（`implement.md`） | `implementer`・`pr-writer`・`pr-reviewer` |
| 実装中に issue の穴が見つかった（implementer の「終わりの判定を満たせない」・pr-reviewer の「issue から見直し」） | `implement.md` の 2-6 から `issue-fix.md` へ | `issue-fixer`・`issue-reviewer` |
| 起票した直後の点検・起票済みの issue の判定 | `/flow issue-fix`（`issue-fix.md`） | `issue-reviewer`、直しが要れば `issue-fixer` |
| 依頼を issue にする | `/flow issue-create`（`issue-create.md`） | （agent なし。点検は `issue-fix.md` に委ねる） |

`issue-fixer` は issue 1 本と配下の本文・タイトルを gh api で直し、sub-issue の追加と close もする（design-doc の段は書き換えず人に返す。リポジトリのファイルは書かない）。
**人が読む要約・issue・PR 本文の書き方は [`docs/README.md`](../docs/README.md) が持つ。**
**commit の直前に回る柵は [`.githooks/pre-commit`](../.githooks/pre-commit) が持つ**（何を止めるかは hook を読む。有効にする手順は [`CONTRIBUTING.md`](../CONTRIBUTING.md)）。
**push の直前に回る柵は [`.githooks/pre-push`](../.githooks/pre-push) が持つ**（検査を消す・緩める差分を [`agents/test-diff-reviewer.md`](agents/test-diff-reviewer.md) に読ませる。差分が無ければ呼ばない。起こした経緯は [school-festival-shift#343](https://github.com/jun-eg/school-festival-shift/issues/343)）。
人が抜けるのは `git push --no-verify` だけで、guard-bash が Claude には打たせない（`-c core.hooksPath=...` で hook を差し替える形も止める）。

何を止めているかは [`settings.json`](settings.json) と
[`hooks/guard-bash.py`](hooks/guard-bash.py) の拒否メッセージを読む（**ここには写さない。二重に持つと片方が古くなる**）。
なぜ止めるのかと、jq + grep 版と比べて python3 を採った経緯は
[issue #73](https://github.com/jun-eg/school-festival-shift/issues/73)。

**`skills/wrangler/` と `skills/workers-best-practices/` は上流 [`cloudflare/skills`](https://github.com/cloudflare/skills) の commit `1a33048`（2026-10-31）をそのまま写したもの**（中身は書き換えない。`LICENSE` は上流の Apache-2.0）。更新は上流と diff を取って写し直す。

## 2 層あるのはなぜか、rebase が deny に無いのはなぜか

`permissions.deny` は**前置一致**なので `git push --force origin foo` は止まるが
`git push origin foo --force` を拾えない。そこをフックが見る。
逆にフックは `python3` が無ければ素通りする。**片方では穴が残るので両方置く。**

**`git rebase` は `deny` に入れていない。** 前置一致だと、途中で詰まったときの逃げ道である
`git rebase --abort` まで落ちてしまうためである。rebase の判断はフックが持ち、`--abort` と `--quit` だけ通す。
**「deny に抜けがある」と思って足さないこと。**

**`gh pr merge` も `deny` に入れていない。** Claude が merge してよいのは `main` 以外の branch（クッション branch）向けの PR だけで
（[issue #320](https://github.com/jun-eg/school-festival-shift/issues/320)）、前置一致では PR の base を判定できない。
フックが `gh pr view <N> --json baseRefName` で base を引き、`main` なら止める。引けなければ止める側に倒す。
番号の無い `gh pr merge` と REST の `pulls/<N>/merge` も止める（base の判定を素通りさせない）。
remote の branch を消す形（`git push --delete`・`:branch`、`gh pr merge --delete-branch`、`gh pr close --delete-branch`、REST `git/refs/heads` の DELETE、GraphQL `deleteRef`・`updateRefs`、`git push --prune`・`--mirror`）もフックが止める。消すのはリポジトリ設定（merge 時に head branch を自動削除）が担う。
**拾えない形もある。** ファイルから読む GraphQL の query（`gh api graphql -F query=@q.graphql`）と、`git -c remote.origin.push=:x push origin` のような設定経由の refspec はコマンド行に出ないので素通りする。
`main` への `git push` は refspec で見る。`git push origin main` だけは前置一致で拾えるので `deny` にもある。

## 例外：どうしても必要になったら

`deny` もフックも**確認ダイアログを出さずに落とす**ので、「そのときだけ許可」ができない。
抜けるには**人が明示的に動く**。次のどちらか。

1. **ユーザー自身がその場で打つ。** プロンプトで `! git push --force ...` と打てば人の手で実行される。
2. **[`settings.json`](settings.json) の該当行を外し、作業後に戻す。** 外したこと・戻したことを PR か報告に書く。

**Claude が自分の判断で 1 や 2 をやることはしない。**

## 確かめ方

```
python3 .claude/hooks/guard-bash.test.py
```

**止まる形と通る形を 1 本ずつ突き合わせる。この検査が契約であって、実装ではない。**
何も書き換えない。全件一致なら終了コード 0、1 つでも外れたら 1 で落ちる。

`settings.json` を書き換えたら、**`/hooks` を一度開くかセッションを開き直す。**
起動時に設定ファイルが無かったディレクトリは監視されないので、**足したその場では効かないことがある。**

## 足すとき

**「コマンドの形」で書けるものだけをここに足す。** 形にならない約束は、
**その瞬間に目に入る器**へ置く（例: [`.github/pull_request_template.md`](../.github/pull_request_template.md)）。
