// X認可フローの検査 — 通る形と止まる形。トークンは架空の値で、標準出力に出ないことを数える。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { authorizeUrl, flow, pkce, SCOPES, TOKEN_URL, WORKER } from './X認可フロー.mjs'

const script = fileURLToPath(new URL('./X認可フロー.mjs', import.meta.url))
const refreshValue = 'fake-refresh-value-0001'
const accessValue = 'fake-access-value-0001'

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// ブラウザの代わり: 表示された URL の state を拾って、loopback のコールバックを叩く
function fakeBrowser(redirectUri, query) {
  const lines = []
  const log = (line) => {
    lines.push(line)
    if (line.startsWith('https://x.com/i/oauth2/authorize')) {
      const state = new URL(line).searchParams.get('state')
      const params = query(state)
      setTimeout(() => fetch(`${redirectUri}?${new URLSearchParams(params)}`).catch(() => {}), 10)
    }
  }
  return { lines, log }
}

function fakeX(reply) {
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url, init })
    return reply()
  }
  return { fetch, requests }
}

const ok = () =>
  Response.json({ token_type: 'bearer', expires_in: 7200, access_token: accessValue, refresh_token: refreshValue })

async function setup(reply, query = (state) => ({ code: 'auth-code-1', state })) {
  const redirectUri = `http://127.0.0.1:${await freePort()}/callback`
  const browser = fakeBrowser(redirectUri, query)
  const x = fakeX(reply)
  const puts = []
  const run = async (args, input) => {
    puts.push({ args, input })
    return 0
  }
  return { redirectUri, browser, x, puts, run }
}

test('通る形: 交換して wrangler secret put の標準入力に渡し、トークンを出力に出さない', async () => {
  const t = await setup(ok)
  await flow({ clientId: 'client-1', redirectUri: t.redirectUri, fetch: t.x.fetch, run: t.run, log: t.browser.log })

  assert.deepEqual(t.puts, [
    { args: ['wrangler', 'secret', 'put', 'X_REFRESH_TOKEN', '--name', WORKER], input: refreshValue },
  ])
  const out = t.browser.lines.join('\n')
  assert.ok(!out.includes(refreshValue))
  assert.ok(!out.includes(accessValue))

  const [req] = t.x.requests
  assert.equal(req.url, TOKEN_URL)
  const body = req.init.body
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(body.get('code'), 'auth-code-1')
  assert.equal(body.get('client_id'), 'client-1')
  assert.equal(body.get('redirect_uri'), t.redirectUri)
  // client secret は付けない（公開クライアント）
  assert.equal(body.has('client_secret'), false)
  assert.equal(new Headers(req.init.headers).has('authorization'), false)
  // 認可の要求の code_challenge は、交換で送る verifier の SHA-256
  const authLine = t.browser.lines.find((l) => l.startsWith('https://x.com/i/oauth2/authorize'))
  const challenge = new URL(authLine).searchParams.get('code_challenge')
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), challenge)
})

test('認可の URL は scope・PKCE（S256）・state を持つ', () => {
  const { challenge, state } = pkce()
  const url = new URL(authorizeUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:1/callback', challenge, state }))
  assert.equal(url.searchParams.get('scope'), SCOPES)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('state'), state)
})

test('止まる形: state が合わなければ交換も secret put もしない', async () => {
  const t = await setup(ok, () => ({ code: 'auth-code-1', state: 'wrong' }))
  await assert.rejects(
    flow({ clientId: 'c', redirectUri: t.redirectUri, fetch: t.x.fetch, run: t.run, log: t.browser.log }),
    /state/,
  )
  assert.equal(t.x.requests.length, 0)
  assert.equal(t.puts.length, 0)
})

test('止まる形: 認可で拒否されたら交換も secret put もしない', async () => {
  const t = await setup(ok, (state) => ({ error: 'access_denied', state }))
  await assert.rejects(
    flow({ clientId: 'c', redirectUri: t.redirectUri, fetch: t.x.fetch, run: t.run, log: t.browser.log }),
    /access_denied/,
  )
  assert.equal(t.puts.length, 0)
})

test('止まる形: 交換が 400 なら secret put せず、応答の本文を出さない', async () => {
  const t = await setup(() =>
    Response.json({ error: 'invalid_request', error_description: `echo ${refreshValue}` }, { status: 400 }),
  )
  await assert.rejects(
    flow({ clientId: 'c', redirectUri: t.redirectUri, fetch: t.x.fetch, run: t.run, log: t.browser.log }),
    (e) => /400 invalid_request/.test(e.message) && !e.message.includes(refreshValue),
  )
  assert.equal(t.puts.length, 0)
})

test('止まる形: refresh token が返らなければ secret put しない', async () => {
  const t = await setup(() => Response.json({ access_token: accessValue }))
  await assert.rejects(
    flow({ clientId: 'c', redirectUri: t.redirectUri, fetch: t.x.fetch, run: t.run, log: t.browser.log }),
    /offline\.access/,
  )
  assert.equal(t.puts.length, 0)
})

test('止まる形: secret put が失敗したら、値を出さずに失敗で終わる', async () => {
  const t = await setup(ok)
  await assert.rejects(
    flow({ clientId: 'c', redirectUri: t.redirectUri, fetch: t.x.fetch, run: async () => 1, log: t.browser.log }),
    (e) => /wrangler secret put/.test(e.message) && !e.message.includes(refreshValue),
  )
  assert.ok(!t.browser.lines.join('\n').includes(refreshValue))
})

test('止まる形: リダイレクトが来なければ時間切れで終わる', async () => {
  const redirectUri = `http://127.0.0.1:${await freePort()}/callback`
  await assert.rejects(
    flow({ clientId: 'c', redirectUri, fetch: async () => ok(), run: async () => 0, log: () => {}, waitMs: 50 }),
    /リダイレクトが来なかった/,
  )
})

test('X_CLIENT_ID が無ければ、何も出さず 1 で落ちる', () => {
  const env = { ...process.env }
  delete env.X_CLIENT_ID
  const r = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /X_CLIENT_ID/)
})
