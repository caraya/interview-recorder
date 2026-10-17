import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { connectDatabase } from './client.mjs'

const { db, pool } = connectDatabase()
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle/', import.meta.url)) })
  console.log('PostgreSQL migrations applied.')
} finally {
  await pool.end()
}
