import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { interviews } from './schema.mjs'

export function connectDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Set DATABASE_URL in .env and run npm run db:migrate.')
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000, max: 5 })
  pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message))
  return { db: drizzle(pool, { schema: { interviews } }), pool }
}
