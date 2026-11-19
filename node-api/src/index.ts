import express, { type ErrorRequestHandler } from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { config } from './config.js'
import { publicRouter } from './routes/public.js'
import { internalRouter } from './routes/internal.js'
import { startDpsSimulation } from './services/dpsUnits.js'
import { ridesRouter } from './routes/rides.js'
import { startRides } from './services/rides.js'
import { startRecent } from './services/recent.js'
import { authRouter, idpRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'

const app = express()
app.use(cors({ origin: config.corsOrigin }))

app.get('/health', (_req, res) => res.json({ ok: true, service: 'node-api' }))

// SSE chat proxy → FastAPI /ai/chat. Mounted BEFORE express.json() so the body streams through untouched.
app.use('/api/chat', createProxyMiddleware({
  target: config.aiServiceUrl,
  changeOrigin: true,
  pathRewrite: () => '/ai/chat',
  headers: { 'X-Internal-Key': config.internalKey },
  on: {
    proxyRes: (proxyRes) => { proxyRes.headers['x-accel-buffering'] = 'no'; proxyRes.headers['cache-control'] = 'no-cache' },
  },
}))

app.use(express.json())
app.use('/auth', authRouter)
app.use('/idp', idpRouter)
app.use('/api/rides', ridesRouter)
app.use('/api', meRouter)
app.use('/api', publicRouter)
app.use('/internal', internalRouter)

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err)
  res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: err?.message ?? 'internal error' })
}
app.use(onError)

startDpsSimulation()
startRides()
startRecent()
app.listen(config.port, () => console.log(`node-api listening on :${config.port}`))
