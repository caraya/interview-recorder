import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { connectDatabase } from '../server/db/client.mjs'
import { interviews } from '../server/db/schema.mjs'
import { interviewApi, HttpError, json } from '../server/interviews.mjs'

test('PostgreSQL interview lifecycle, idempotency, audio, validation and failures', async (t) => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.')
  const { db, pool } = connectDatabase(process.env.TEST_DATABASE_URL)
  const audioDir = await mkdtemp(join(tmpdir(), 'fieldnote-integration-'))
  const ids = []
  const api = interviewApi({ db, audioDir })
  const server = createServer(async (req, res) => {
    try {
      if (!await api(req, res, new URL(req.url, `http://${req.headers.host}`))) json(res, 404, { error: 'Not found' })
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      json(res, error instanceof HttpError ? error.status : 503, { error: error.message })
    }
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    for (const id of ids) await db.delete(interviews).where(eq(interviews.id, id))
    await pool.end()
    await rm(audioDir, { recursive: true })
  })
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { Origin: base }
  const metadata = {
    id: randomUUID(), title: 'Integration interview', project: 'Research', createdAt: new Date().toISOString(),
    duration: 65.5, model: 'nova-3', language: 'en', starred: false, notes: 'Initial notes',
    segments: [{ speaker: 0, start: 1, text: 'Hello PostgreSQL.' }, { speaker: 1, start: 3, text: 'Hello Drizzle.' }],
  }
  ids.push(metadata.id)
  const bytes = Buffer.from('test-audio-data')
  const upload = async (data = metadata, type = 'audio/webm') => {
    const form = new FormData()
    form.set('metadata', JSON.stringify(data))
    form.set('audio', new Blob([bytes], { type }), 'recording.webm')
    return fetch(`${base}/api/interviews`, { method: 'POST', headers, body: form })
  }
  let response = await upload()
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.id, metadata.id)
  assert.equal('audioFile' in saved, false)
  assert.equal(saved.transcript, '[00:01] Speaker 1: Hello PostgreSQL.\n\n[00:03] Speaker 2: Hello Drizzle.')
  assert.deepEqual(saved.segments, metadata.segments)
  const [stored] = await db.select().from(interviews).where(eq(interviews.id, metadata.id))
  assert.equal(stored.audioSize, bytes.length)
  assert.equal(stored.notes, 'Initial notes')
  assert.equal((await readdir(audioDir)).length, 1)

  response = await fetch(`${base}/api/interviews/${metadata.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Updated notes', starred: true }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).starred, true)
  response = await upload()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).notes, 'Updated notes', 'retry must preserve existing edits')
  assert.equal((await readdir(audioDir)).length, 1, 'retry must not leave duplicate audio')
  const listed = await (await fetch(`${base}/api/interviews`)).json()
  assert.ok(listed.some((item) => item.id === metadata.id && item.starred))
  assert.deepEqual(Buffer.from(await (await fetch(`${base}${saved.audioUrl}`)).arrayBuffer()), bytes)
  response = await fetch(`${base}${saved.audioUrl}`, { headers: { Range: 'bytes=2-5' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 2-5/${bytes.length}`)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(2, 6))
  response = await fetch(`${base}${saved.audioUrl}`, { headers: { Range: 'bytes=-4' } })
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(-4))
  assert.equal((await fetch(`${base}${saved.audioUrl}`, { headers: { Range: 'bytes=999-' } })).status, 416)
  assert.equal((await fetch(`${base}${saved.audioUrl}`, { method: 'HEAD' })).headers.get('content-length'), String(bytes.length))
  assert.equal((await upload({ ...metadata, duration: -1 })).status, 400)
  assert.equal((await upload(metadata, 'text/plain')).status, 415)
  assert.equal((await fetch(`${base}/api/interviews/${metadata.id}`, { method: 'DELETE', headers: { Origin: 'https://other.example' } })).status, 403)
  assert.equal((await fetch(`${base}/api/interviews/${metadata.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"audioFile":"../bad"}' })).status, 400)
  assert.equal((await fetch(`${base}/api/interviews/${metadata.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: 'invalid' })).status, 400)
  assert.equal((await fetch(`${base}/api/interviews/not-a-uuid`)).status, 400)
  assert.equal((await fetch(`${base}/api/interviews/${randomUUID()}`)).status, 404)
  response = await fetch(`${base}/api/interviews/${metadata.id}`, { method: 'DELETE', headers })
  assert.equal(response.status, 200)
  assert.deepEqual(await readdir(audioDir), [])
  assert.equal((await fetch(`${base}${saved.audioUrl}`)).status, 404)
  assert.equal((await db.select().from(interviews).where(eq(interviews.id, metadata.id))).length, 0)

  // A failed insert must not leave an unreferenced audio file behind.
  const brokenApi = interviewApi({ db: { insert() { throw new Error('Database unavailable') } }, audioDir })
  const broken = createServer(async (req, res) => {
    try { await brokenApi(req, res, new URL(req.url, 'http://localhost')) }
    catch { json(res, 503, { error: 'Database unavailable' }) }
  })
  await new Promise((resolve) => broken.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${broken.address().port}`
    const form = new FormData()
    form.set('metadata', JSON.stringify(metadata))
    form.set('audio', new Blob([bytes], { type: 'audio/webm' }), 'audio.webm')
    assert.equal((await fetch(`${origin}/api/interviews`, { method: 'POST', headers: { Origin: origin }, body: form })).status, 503)
    assert.deepEqual(await readdir(audioDir), [])
  } finally { await new Promise((resolve) => broken.close(resolve)) }
})
