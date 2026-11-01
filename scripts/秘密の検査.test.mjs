// 秘密の検査の検査 — 通る形と止まる形。本物の秘密は 1 つも書かない（形に当たる文字列は、その場で組み立てる）。

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { knownValues, scan } from './秘密の検査.mjs'

const filler = 'abcdefghijklmnopqrstuvwxyz0123456789'
const githubToken = `${'gh'}p_${filler}`
const githubPat = `${'github'}_pat_${filler}`
const awsKeyId = `${'AK'}IA${'ABCDEFGHIJKLMNOP'}`
const anthropicKey = `${'sk'}-ant-${filler}`
const accessToken = `${'ya'}29.${filler}`
const refreshToken = `1/${'/'}${filler}`
const clientSecret = `${'GOC'}SPX-${filler}`
const clientId = `123456789012-${filler}.apps.googleusercontent.com`

test('通る形 — 普通のファイルと、空の雛形 .env.example', () => {
  assert.deepEqual(
    scan([
      { path: 'src/a.ts', text: 'const x = 1' },
      { path: '.env.example', text: 'API_TOKEN=\n' },
      { path: 'workers/ingest/.dev.vars.example', text: 'IFTTT_SECRET=\n' },
      { path: 'docs/a.md', text: '`refresh_token` は書かない。ghp_ で始まるものは貼らない' },
    ]),
    [],
  )
})

test('止まる形 — 名前', () => {
  for (const name of ['.env', '.env.local', '.dev.vars', '.dev.vars.staging', 'workers/ingest/.dev.vars', '.clasprc.json', 'creds.json', 'x/my-creds.json', 'client_secret_1.json']) {
    assert.equal(scan([{ path: name, text: '' }]).length, 1, name)
  }
})

test('止まる形 — 中身（値そのものは出力に入らない）', () => {
  for (const text of [githubToken, githubPat, awsKeyId, anthropicKey, accessToken, refreshToken, clientSecret, clientId, '-----BEGIN ' + 'PRIVATE KEY-----', '{"refresh' + '_token": "' + filler + '"}']) {
    const problems = scan([{ path: 'a.txt', text: `x ${text} y` }])
    assert.equal(problems.length >= 1, true, text)
    assert.equal(problems.join('\n').includes(filler), false)
  }
})

test('止まる形 — .env に書いた値そのもの（短いもの・コメントは見ない）', () => {
  const known = knownValues('API_TOKEN=AKfycbxXXXXXXXXXXXX\nexport SHEET_ID="1AbCdEfGhIjKlMn"\nREGION=short\n# NOTE=zzzzzzzzzzzz\n')
  assert.deepEqual(
    known.map(([name]) => name),
    ['API_TOKEN', 'SHEET_ID'],
  )
  assert.equal(scan([{ path: 'a.md', text: 'id: 1AbCdEfGhIjKlMn' }], known).length, 1)
  assert.equal(scan([{ path: 'a.md', text: 'id: nothing' }], known).length, 0)
})

// 一時 repo で、検査の本体（ステージ → .dev.vars の値の照合 → 終了コード）を通しで回す。
const script = fileURLToPath(new URL('./秘密の検査.mjs', import.meta.url))

function runInTempRepo(devVarsText, stagedText, { brokenSymlink = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-check-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    git('init', '-q')
    fs.mkdirSync(path.join(dir, 'workers/ingest'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'workers/ingest/.dev.vars'), devVarsText)
    if (brokenSymlink) fs.symlinkSync(path.join(dir, 'nothing'), path.join(dir, '.dev.vars.broken'))
    fs.writeFileSync(path.join(dir, 'notes.md'), stagedText)
    git('add', 'notes.md')
    const result = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' })
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('止まる形 — workers/ingest/.dev.vars の値を含むファイルをステージすると exit 1（値は出さない）', () => {
  const { status, output } = runInTempRepo('IFTTT_SECRET=zzzz-local-secret-1234\n', 'memo: zzzz-local-secret-1234\n')
  assert.equal(status, 1)
  assert.equal(output.includes('IFTTT_SECRET'), true)
  assert.equal(output.includes('zzzz-local-secret-1234'), false)
})

test('通る形 — .dev.vars の値を含まなければ exit 0。壊れた symlink の .dev.vars* があっても落ちない', () => {
  assert.equal(runInTempRepo('IFTTT_SECRET=zzzz-local-secret-1234\n', 'memo: nothing\n').status, 0)
  assert.equal(runInTempRepo('IFTTT_SECRET=zzzz-local-secret-1234\n', 'memo: nothing\n', { brokenSymlink: true }).status, 0)
})
