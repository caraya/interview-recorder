import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { interviews } from './db/schema.mjs'
import { allowedOrigin } from './config.mjs'
import { transcriptText } from '../src/lib/transcript.ts'

const MAX_UPLOAD = 256 * 1024 * 1024
const metadataSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  project: z.string().max(80),
  createdAt: z.iso.datetime({ offset: true }),
  duration: z.number().finite().min(0),
  model: z.enum(['nova-3', 'nova-2']),
  language: z.enum(['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'multi']),
  starred: z.boolean(),
  notes: z.string().max(1_000_000),
  segments: z.array(z.object({
    speaker: z.number().int().min(0).nullable(),
    start: z.number().finite().min(0),
    text: z.string().max(100_000),
  }).strict()).max(100_000),
}).strict()
const patchSchema = z.object({
  title: metadataSchema.shape.title.optional(),
  project: metadataSchema.shape.project.optional(),
  notes: metadataSchema.shape.notes.optional(),
  starred: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'No changes provided.')

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}
export function publicInterview(row) {
  const { audioFile: _file, ...metadata } = row
  return { ...metadata, audioUrl: `/api/interviews/${row.id}/audio` }
}
async function body(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, `Request exceeds the ${Math.floor(limit / 1024 / 1024)} MiB upload limit.`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function validate(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) throw new HttpError(400, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 1000))
  return result.data
}
function parseJSON(input) {
  try { return JSON.parse(input) }
  catch { throw new HttpError(400, 'Invalid JSON.') }
}

export function interviewApi({ db, audioDir }) {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/interviews')) return false
    if (!['GET', 'HEAD'].includes(req.method) && !allowedOrigin(req.headers.origin, req.headers.host)) {
      throw new HttpError(403, 'A matching Origin header is required.')
    }
    if (!db) throw new HttpError(503, 'PostgreSQL is not configured. Set DATABASE_URL and run npm run db:migrate.')
    const match = /^\/api\/interviews(?:\/([^/]+)(\/audio)?)?$/.exec(url.pathname)
    if (!match) throw new HttpError(404, 'Interview endpoint not found.')
    const [, id, audio] = match
    if (id) validate(z.uuid(), id)

    if (!id && req.method === 'GET') {
      json(res, 200, (await db.select().from(interviews).orderBy(desc(interviews.createdAt))).map(publicInterview))
      return true
    }
    if (!id && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('multipart/form-data;')) throw new HttpError(415, 'Use multipart/form-data with metadata and audio fields.')
      const bytes = await body(req, MAX_UPLOAD)
      let form
      try {
        form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: bytes }).formData()
      } catch { throw new HttpError(400, 'Invalid multipart upload.') }
      const raw = form.get('metadata')
      if (typeof raw !== 'string' || raw.length > 8 * 1024 * 1024) throw new HttpError(400, 'Missing or oversized metadata.')
      const metadata = validate(metadataSchema, parseJSON(raw))
      const file = form.get('audio')
      if (!(file instanceof File) || !file.size) throw new HttpError(400, 'A non-empty audio file is required.')
      if (!['audio/webm', 'audio/mp4', 'audio/webm;codecs=opus'].includes(file.type)) throw new HttpError(415, 'Audio must be WebM/Opus or MP4.')
      const audioFile = `${randomUUID()}.${file.type.includes('mp4') ? 'mp4' : 'webm'}`
      await mkdir(audioDir, { recursive: true, mode: 0o700 })
      const path = join(audioDir, audioFile)
      let row
      try {
        await writeFile(path, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 })
        // A client-generated ID makes retries/imports idempotent without replacing existing edits.
        ;[row] = await db.insert(interviews).values({
          ...metadata, transcript: transcriptText(metadata.segments),
          audioFile, audioType: file.type, audioSize: file.size,
        }).onConflictDoNothing({ target: interviews.id }).returning()
      } catch (error) {
        await unlink(path).catch((cleanupError) => { if (cleanupError.code !== 'ENOENT') console.error('Failed upload cleanup:', cleanupError) })
        throw error
      }
      if (!row) {
        await unlink(path)
        ;[row] = await db.select().from(interviews).where(eq(interviews.id, metadata.id))
        if (!row) throw new HttpError(409, 'Interview changed during import. Retry the upload.')
      }
      json(res, 200, publicInterview(row))
      return true
    }
    if (!id) throw new HttpError(405, 'Method not allowed.')
    if (!audio && req.method === 'PATCH') {
      if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json.')
      const patch = validate(patchSchema, parseJSON((await body(req, 2 * 1024 * 1024)).toString()))
      const [row] = await db.update(interviews).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(interviews.id, id)).returning()
      if (!row) throw new HttpError(404, 'Interview not found.')
      json(res, 200, publicInterview(row))
      return true
    }
    if (!audio && req.method === 'DELETE') {
      // Commit the database deletion first; report filesystem cleanup problems explicitly.
      const [row] = await db.delete(interviews).where(eq(interviews.id, id)).returning()
      if (!row) throw new HttpError(404, 'Interview not found.')
      try { await unlink(join(audioDir, row.audioFile)) }
      catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Deleted interview audio cleanup failed:', error)
          json(res, 200, { warning: 'Interview deleted, but its audio file could not be removed. Check server disk permissions and logs.' })
          return true
        }
      }
      json(res, 200, { deleted: true })
      return true
    }
    const [row] = await db.select().from(interviews).where(eq(interviews.id, id))
    if (!row) throw new HttpError(404, 'Interview not found.')
    if (!audio && req.method === 'GET') {
      json(res, 200, publicInterview(row))
      return true
    }
    if (audio && ['GET', 'HEAD'].includes(req.method)) {
      const path = join(audioDir, row.audioFile)
      let info
      try { info = await stat(path) }
      catch (error) {
        if (error.code === 'ENOENT') throw new HttpError(404, 'Audio file is missing from server storage. Restore it from backup.')
        throw error
      }
      const range = req.headers.range
      let start = 0
      let end = info.size - 1
      if (range) {
        const parts = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!parts || (!parts[1] && !parts[2])) throw new HttpError(416, 'Invalid audio range.')
        if (!parts[1]) start = Math.max(0, info.size - Number(parts[2]))
        else { start = Number(parts[1]); if (parts[2]) end = Math.min(end, Number(parts[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
          res.setHeader('Content-Range', `bytes */${info.size}`)
          throw new HttpError(416, 'Audio range is outside the file.')
        }
      }
      const headers = {
        'Content-Type': row.audioType, 'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1, 'Cache-Control': 'no-store',
      }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
      res.writeHead(range ? 206 : 200, headers)
      if (req.method === 'HEAD') res.end()
      else await pipeline(createReadStream(path, { start, end }), res)
      return true
    }
    throw new HttpError(405, 'Method not allowed.')
  }
}
