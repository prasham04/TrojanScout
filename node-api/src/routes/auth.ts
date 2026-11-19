// Sign-in with OpenID Connect (authorization code + PKCE). The client half is the real thing:
// discovery, state + nonce, PKCE, code exchange, id_token verified against the provider's JWKS.
//
// Identity providers:
//  - University SSO (production): set OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET once TrojanScout is
//    registered with the university's IdP (USC uses Okta/Shibboleth via ITS). Then "Sign in" goes to the real SSO page.
//  - Built in (default): TrojanScout's own sign-in at /idp. It verifies that you own a university email by sending
//    a 6-digit one-time code. It is TrojanScout-branded, never imitates the university's login, and never asks for a password.
import { Router, urlencoded } from 'express'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import axios from 'axios'
import { createRemoteJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose'
import { config } from '../config.js'
import { signSession, upsertFromIdToken } from '../services/users.js'
import { mailConfigured, sendLoginCode } from '../services/mailer.js'

// Render sets RENDER_EXTERNAL_URL to the service's own https URL, so PUBLIC_API_URL is optional there
const API = process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${config.port}`
const FRONT = config.corsOrigin[0]
const LOCAL_ISSUER = `${API}/idp`
const OIDC = {
  issuer: process.env.OIDC_ISSUER ?? LOCAL_ISSUER,
  clientId: process.env.OIDC_CLIENT_ID ?? 'trojanscout-web',
  clientSecret: process.env.OIDC_CLIENT_SECRET ?? 'local-secret',
  redirectUri: `${API}/auth/callback`,
}
const DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'usc.edu').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)

const b64url = (b: Buffer) => b.toString('base64url')
const rand = () => b64url(randomBytes(24))
const s256 = (v: string) => b64url(createHash('sha256').update(v).digest())
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export const authRouter = Router()
authRouter.use(urlencoded({ extended: false }))

// ---------------- client (TrojanScout ↔ any OIDC provider) ----------------
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
let discovery: Discovery | null = null
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
async function discover() {
  if (!discovery) {
    discovery = (await axios.get(`${OIDC.issuer}/.well-known/openid-configuration`, { timeout: 8000 })).data as Discovery
    jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
  }
  return discovery
}
const pending = new Map<string, { nonce: string; verifier: string; ret: string; exp: number }>()
const safeReturn = (r: unknown) => (typeof r === 'string' && /^\/[\w\-/?=&%.]*$/.test(r) ? r : '/')

// Shown on the code page while no email service is configured. Render sets RENDER=true on its servers.
const NO_MAIL_NOTE = process.env.RENDER
  ? '<div class="dev"><b>Email isn’t set up on this server yet.</b> The code is in the Render dashboard: <b>trojanscout-api → Logs</b>, on the line starting with ✉️ <b>[dev] TrojanScout sign-in code</b>. To email codes, add BREVO_API_KEY and MAIL_FROM under trojanscout-api → Environment.</div>'
  : '<div class="dev"><b>No email is sent in development mode.</b> Your code is in the terminal running <code>npm run dev</code>, on the line starting with ✉️ <b>[dev] TrojanScout sign-in code</b>. Add BREVO_API_KEY + MAIL_FROM to node-api/.env to email it instead.</div>'

authRouter.get('/config', (_req, res) => res.json({ issuer: OIDC.issuer, builtIn: OIDC.issuer === LOCAL_ISSUER, domains: DOMAINS, emailDelivery: mailConfigured ? 'email' : 'server-console' }))

authRouter.get('/login', async (req, res, next) => {
  try {
    const d = await discover()
    const state = rand(), nonce = rand(), verifier = rand() + rand()
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k)
    pending.set(state, { nonce, verifier, ret: safeReturn(req.query.return), exp: Date.now() + 15 * 60e3 })
    const u = new URL(d.authorization_endpoint)
    Object.entries({ response_type: 'code', client_id: OIDC.clientId, redirect_uri: OIDC.redirectUri, scope: 'openid email profile', state, nonce, code_challenge: s256(verifier), code_challenge_method: 'S256' })
      .forEach(([k, v]) => u.searchParams.set(k, v))
    res.redirect(u.toString())
  } catch (e) { next(e) }
})

authRouter.get('/callback', async (req, res) => {
  const fail = (msg: string) => res.redirect(`${FRONT}/auth/done#error=${encodeURIComponent(msg)}`)
  if (req.query.error) return fail(String(req.query.error_description ?? req.query.error))
  const st = pending.get(String(req.query.state ?? ''))
  if (!st || st.exp < Date.now()) return fail('Sign-in expired, please try again')
  pending.delete(String(req.query.state))
  try {
    const d = await discover()
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code ?? ''), redirect_uri: OIDC.redirectUri, client_id: OIDC.clientId, client_secret: OIDC.clientSecret, code_verifier: st.verifier })
    const tok = (await axios.post(d.token_endpoint, body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 })).data
    const { payload } = await jwtVerify(tok.id_token, jwks!, { issuer: d.issuer, audience: OIDC.clientId })
    if (payload.nonce !== st.nonce) return fail('Sign-in check failed')
    if (payload.email_verified === false) return fail('Your email address is not verified')
    const { user, isNew } = upsertFromIdToken(d.issuer, String(payload.sub), String(payload.email ?? ''), String(payload.name ?? ''))
    const session = await signSession(user)
    // new accounts go to preferences (fill in or skip), then the landing page
    const next = isNew || !user.onboarded ? `/preferences?onboarding=1${isNew ? '&registered=1' : ''}` : st.ret
    res.redirect(`${FRONT}/auth/done#token=${session}&return=${encodeURIComponent(next)}`)
  } catch (e) { console.error('oidc callback', (e as Error).message); fail('Could not complete sign-in') }
})

// ---------------- built-in identity provider: email + one-time code ----------------
export const idpRouter = Router()
idpRouter.use(urlencoded({ extended: false }))
const keys = generateKeyPair('RS256').then(async (k) => ({ ...k, jwk: { ...(await exportJWK(k.publicKey)), kid: 'ts-1', alg: 'RS256', use: 'sig' } as JWK }))
const codes = new Map<string, { sub: string; email: string; name: string; nonce: string; clientId: string; redirectUri: string; challenge: string; exp: number }>()
const otps = new Map<string, { hash: string; exp: number; tries: number; sentAt: number }>()  // by email
const hashOtp = (email: string, code: string) => createHash('sha256').update(`${email}:${code}:${OIDC.clientSecret}`).digest()

idpRouter.get('/.well-known/openid-configuration', (_req, res) => res.json({
  issuer: LOCAL_ISSUER, authorization_endpoint: `${LOCAL_ISSUER}/authorize`, token_endpoint: `${LOCAL_ISSUER}/token`, jwks_uri: `${LOCAL_ISSUER}/jwks`,
  response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'email', 'profile'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
}))
idpRouter.get('/jwks', async (_req, res) => res.json({ keys: [(await keys).jwk] }))

const PARAMS = ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge'] as const
type Params = Record<(typeof PARAMS)[number], string>
const hidden = (q: Params) => PARAMS.map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] ?? '')}">`).join('')
const validClient = (q: Partial<Params>) => q.client_id === OIDC.clientId && q.redirect_uri === OIDC.redirectUri

function page(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · TrojanScout</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f4;margin:0;display:grid;place-items:center;min-height:100vh;color:#1c1917}
.card{background:#fff;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.08);padding:30px;width:min(400px,calc(100vw - 32px));box-sizing:border-box}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px}.logo{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#1c1917;color:#fff;font-size:13px}
h1{font-size:21px;margin:22px 0 6px}p{font-size:14px;color:#57534e;margin:0 0 18px;line-height:1.45}
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input[type=email],input[type=text]{width:100%;box-sizing:border-box;border:1px solid #d6d3d1;border-radius:11px;padding:11px 12px;font:inherit;font-size:15px;margin-bottom:12px}
input.code{font-size:26px;letter-spacing:10px;text-align:center;font-weight:700}
button{width:100%;background:#1c1917;color:#fff;border:0;border-radius:11px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
.link{background:none;color:#57534e;font-weight:600;padding:8px;margin-top:6px}.err{background:#fef2f2;color:#991b1b;border-radius:10px;padding:9px 11px;font-size:13px;margin-bottom:12px}
.dev{background:#fffbeb;color:#92400e;border-radius:10px;padding:9px 11px;font-size:12px;margin-bottom:12px}
.foot{font-size:11px;color:#a8a29e;margin-top:18px;line-height:1.5}</style></head><body><div class="card">
<div class="brand"><span class="logo">TS</span>TrojanScout</div>${body}
<div class="foot">TrojanScout's own sign-in (OpenID Connect). It never asks for your NetID password.<br>When TrojanScout is registered with USC ITS, this step becomes USC single sign-on.</div></div></body></html>`
}
const emailForm = (q: Params, err = '', email = '') => page(`<h1>Sign in or create an account</h1><p>Use your ${DOMAINS.map((d) => '@' + d).join(' / ')} email. We'll send you a 6-digit code.</p>
${err ? `<div class="err">${esc(err)}</div>` : ''}<form method="post" action="${LOCAL_ISSUER}/authorize/send">${hidden(q)}
<label for="email">University email</label><input id="email" type="email" name="email" value="${esc(email)}" placeholder="netid@${DOMAINS[0] ?? 'usc.edu'}" required autofocus maxlength="80">
<label for="name">Name <span style="font-weight:400;color:#a8a29e">(new accounts)</span></label><input id="name" type="text" name="name" maxlength="40" placeholder="First L.">
<button>Send code</button></form>`)
const codeForm = (q: Params, email: string, name: string, err = '') => page(`<h1>Check your email</h1><p>We sent a 6-digit code to <b>${esc(email)}</b>. It expires in 10 minutes.</p>
${mailConfigured ? '' : NO_MAIL_NOTE}
${err ? `<div class="err">${esc(err)}</div>` : ''}<form method="post" action="${LOCAL_ISSUER}/authorize/verify">${hidden(q)}
<input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="name" value="${esc(name)}">
<input class="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus placeholder="••••••">
<button>Verify and continue</button></form>
<form method="post" action="${LOCAL_ISSUER}/authorize/send">${hidden(q)}<input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="name" value="${esc(name)}"><button class="link">Resend code</button></form>`)

const paramsOf = (src: Record<string, unknown>) => Object.fromEntries(PARAMS.map((k) => [k, String(src[k] ?? '')])) as Params

idpRouter.get('/authorize', (req, res) => {
  const q = paramsOf(req.query)
  if (!validClient(q)) return res.status(400).send('Unknown client or redirect_uri')
  res.type('html').send(emailForm(q))
})

idpRouter.post('/authorize/send', async (req, res) => {
  const q = paramsOf(req.body), email = String(req.body.email ?? '').trim().toLowerCase(), name = String(req.body.name ?? '').trim().slice(0, 40)
  if (!validClient(q)) return res.status(400).send('Unknown client')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !DOMAINS.some((d) => email.endsWith('@' + d))) return res.type('html').send(emailForm(q, `Please use your ${DOMAINS.map((d) => '@' + d).join(' or ')} email.`, email))
  const prev = otps.get(email)
  if (prev && Date.now() - prev.sentAt < 30e3) return res.type('html').send(codeForm(q, email, name, 'A code was just sent. Wait 30 seconds before asking for another.'))
  const code = String(randomInt(0, 1e6)).padStart(6, '0')
  otps.set(email, { hash: b64url(hashOtp(email, code)), exp: Date.now() + 10 * 60e3, tries: 0, sentAt: Date.now() })
  try { await sendLoginCode(email, code) } catch (e) {
    // log the provider's own reason (e.g. Brevo's "unrecognised IP address"), never the key or the code
    const r = (e as { response?: { status?: number; data?: { code?: string; message?: string } } }).response
    console.error('mail failed:', r?.status ?? '', r?.data?.code ?? '', r?.data?.message ?? (e as Error).message); otps.delete(email)
    return res.type('html').send(emailForm(q, 'We could not send the email. Try again in a minute.', email))
  }
  res.type('html').send(codeForm(q, email, name))
})

idpRouter.post('/authorize/verify', (req, res) => {
  const q = paramsOf(req.body), email = String(req.body.email ?? '').trim().toLowerCase(), name = String(req.body.name ?? '').trim().slice(0, 40)
  if (!validClient(q)) return res.status(400).send('Unknown client')
  const o = otps.get(email), code = String(req.body.code ?? '').replace(/\D/g, '')
  if (!o || o.exp < Date.now()) return res.type('html').send(emailForm(q, 'That code expired. Request a new one.', email))
  if (++o.tries > 5) { otps.delete(email); return res.type('html').send(emailForm(q, 'Too many wrong codes. Request a new one.', email)) }
  const ok = code.length === 6 && timingSafeEqual(Buffer.from(o.hash), Buffer.from(b64url(hashOtp(email, code))))
  if (!ok) return res.type('html').send(codeForm(q, email, name, `That code isn't right (${6 - o.tries} tries left).`))
  otps.delete(email)
  const authCode = rand()
  codes.set(authCode, { sub: `email:${s256(email).slice(0, 22)}`, email, name: name || email.split('@')[0], nonce: q.nonce, clientId: q.client_id, redirectUri: q.redirect_uri, challenge: q.code_challenge, exp: Date.now() + 60e3 })
  const u = new URL(q.redirect_uri); u.searchParams.set('code', authCode); u.searchParams.set('state', q.state)
  res.redirect(u.toString())
})

idpRouter.post('/token', async (req, res) => {
  const b = req.body as Record<string, string>
  const c = codes.get(b.code); codes.delete(b.code)
  if (!c || c.exp < Date.now() || b.client_id !== c.clientId || b.client_secret !== OIDC.clientSecret || b.redirect_uri !== c.redirectUri || s256(b.code_verifier ?? '') !== c.challenge)
    return res.status(400).json({ error: 'invalid_grant' })
  const k = await keys
  const id_token = await new SignJWT({ email: c.email, name: c.name, nonce: c.nonce, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'ts-1' }).setIssuer(LOCAL_ISSUER).setAudience(c.clientId).setSubject(c.sub).setIssuedAt().setExpirationTime('5m').sign(k.privateKey)
  res.json({ token_type: 'Bearer', id_token, access_token: rand(), expires_in: 300 })
})
