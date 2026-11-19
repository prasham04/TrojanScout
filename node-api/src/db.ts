import pg from 'pg'
import { config } from './config.js'

// Lazily created so the server boots with mocks when DATABASE_URL is empty.
let pool: pg.Pool | null = null
export function db() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL not set')
  pool ??= new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } })
  return pool
}
