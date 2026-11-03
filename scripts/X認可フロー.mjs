#!/usr/bin/env node
// X認可フロー — 最初の refresh token を得て、Worker A の Secret `X_REFRESH_TOKEN` に入れる（→ scripts/README.md）。
//
//   使い方: X_CLIENT_ID=<クライアント ID> node scripts/X認可フロー.mjs
//     X_REDIRECT_URI   X の App の Callback と同じ loopback の URL（既定 http://127.0.0.1:8787/callback）
//
// 認可コードフロー（PKCE）。公開クライアントなので client secret は要らない（9-11）。
// 表示された URL をブラウザで開いて許可すると、loopback でリダイレクトを受けてすぐ交換する。
// 認可コードは数十秒で切れるので、URL を手で貼る形にしない。
//
// トークンの値は標準出力にも標準エラーにも出さない。受け取った refresh token は
// `wrangler secret put X_REFRESH_TOKEN --name x-like-digest-ingest` の標準入力に渡すだけで、ファイルにも残さない。
// access token は使わず捨てる。X_CLIENT_ID と X_USER_ID も Secret だが、この手では入れない（手で `wrangler secret put`）。

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

export const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
export const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
export const SCOPES = 'users.read like.read tweet.read offline.access'
export const WORKER = 'x-like-digest-ingest'
export const SECRET_NAME = 'X_REFRESH_TOKEN'
const DEFAULT_REDIRECT = 'http://127.0.0.1:8787/callback'
const WAIT_MS = 5 * 60 * 1000

export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, state: randomBytes(16).toString('base64url') }
}

export function authorizeUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

// 待ち始めてから URL を見せられるよう、listening を分けて返す
export function listenForCode({ redirectUri, state, timeoutMs = WAIT_MS }) {
  const callback = new URL(redirectUri)
  let server
  const listening = new Promise((resolve, reject) => {
    server = http.createServer()
    server.once('error', reject)
    server.listen(Number(callback.port), callback.hostname, resolve)
  })
  const code = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('リダイレクトが来なかった（5 分）'))
    }, timeoutMs)
    const finish = (fn, value) => {
      clearTimeout(timer)
      server.close()
      fn(value)
    }
    listening.then(() => {
      server.on('request', (req, res) => {
        const got = new URL(req.url ?? '/', redirectUri)
        if (got.pathname !== callback.pathname) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('終わった。ターミナルに戻ってよい')
        if (got.searchParams.get('error')) {
          finish(reject, new Error(`認可で拒否された: ${got.searchParams.get('error')}`))
        } else if (got.searchParams.get('state') !== state) {
          finish(reject, new Error('state が合わない。やり直す'))
        } else if (!got.searchParams.get('code')) {
          finish(reject, new Error('認可コードが付いていない'))
        } else {
          finish(resolve, got.searchParams.get('code'))
        }
      })
    }, (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
  // listening の失敗は呼び出し側が listening を待って受ける。ここでの未処理の拒否を避ける
  code.catch(() => {})
  return { listening, code }
}

// refresh token だけを返す。X の応答の本文は、エラー名以外を出さない
export async function exchange({ fetch: doFetch, clientId, redirectUri, code, verifier }) {
  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const name = typeof json.error === 'string' ? json.error : ''
    throw new Error(`認可コードの交換に失敗した: HTTP ${res.status} ${name}`.trim())
  }
  if (typeof json.refresh_token !== 'string' || json.refresh_token === '') {
    throw new Error('refresh token が返らなかった（scope に offline.access が要る）')
  }
  return json.refresh_token
}

// 既定の run: `npx wrangler ...` を起こし、標準入力にだけ値を渡す
export function runWithStdin(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { stdio: ['pipe', 'inherit', 'inherit'] })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
    child.stdin.end(`${input}\n`)
  })
}

export async function putSecret({ run = runWithStdin, token, worker = WORKER }) {
  const code = await run(['wrangler', 'secret', 'put', SECRET_NAME, '--name', worker], token)
  if (code !== 0) {
    throw new Error(`wrangler secret put が ${code} で終わった。refresh token は残っていないので、認可からやり直す`)
  }
}

export async function flow({
  clientId,
  redirectUri = DEFAULT_REDIRECT,
  fetch: doFetch = fetch,
  run = runWithStdin,
  log = console.log,
  waitMs,
}) {
  const { verifier, challenge, state } = pkce()
  const { listening, code } = listenForCode({ redirectUri, state, timeoutMs: waitMs })
  await listening
  log('この URL をブラウザで開いて許可する（戻ってきたら自動で交換する）:')
  log(authorizeUrl({ clientId, redirectUri, challenge, state }))
  log(`${redirectUri} で待っている…`)
  const token = await exchange({ fetch: doFetch, clientId, redirectUri, code: await code, verifier })
  await putSecret({ run, token })
  log(`${SECRET_NAME} を ${WORKER} の Secret に入れた`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const clientId = process.env.X_CLIENT_ID
  if (!clientId) {
    console.error('X_CLIENT_ID を環境変数で渡す')
    process.exit(1)
  }
  flow({ clientId, redirectUri: process.env.X_REDIRECT_URI || DEFAULT_REDIRECT }).catch((e) => {
    console.error(e instanceof Error ? e.message : '失敗した')
    process.exit(1)
  })
}
