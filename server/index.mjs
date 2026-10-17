import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, extname, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { streamingUrl, allowedOrigin } from './config.mjs'
import { connectDatabase } from './db/client.mjs'
import { interviews } from './db/schema.mjs'
import { interviewApi, HttpError, json } from './interviews.mjs'

const port = Number(process.env.PORT || 3001)
const key = process.env.DEEPGRAM_API_KEY
const configured = Boolean(key && key !== 'your_deepgram_api_key')
const root = fileURLToPath(new URL('../dist/', import.meta.url))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
const database = process.env.DATABASE_URL ? connectDatabase() : null
const audioDir = resolve(fileURLToPath(new URL('../', import.meta.url)), process.env.AUDIO_STORAGE_DIR || 'data/audio')
const handleInterviews = interviewApi({ db: database?.db, audioDir })
const server = createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === '/api/status') {
    let storage = { ready: false, message: 'Set DATABASE_URL and run npm run db:migrate.' }
    if (database) {
      try {
        await database.db.select({ id: interviews.id }).from(interviews).limit(1)
        storage = { ready: true, message: 'PostgreSQL connected.' }
      } catch (error) {
        console.error('Database health check failed:', error.message)
        storage = { ready: false, message: 'PostgreSQL is unavailable or migrations have not been applied.' }
      }
    }
    json(res, 200, { configured, storage })
    return
  }
  if (await handleInterviews(req, res, url)) return
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404).end('Not found')
    return
  }
  const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`)
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  try {
    const content = await readFile(path)
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' })
    res.end(content)
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') console.error('Static file error:', error)
    res.writeHead(404).end('Not found. Run npm run build to create the application.')
  }
  } catch (error) {
    console.error('Request failed:', error)
    if (res.headersSent) { res.destroy(); return }
    const status = error instanceof HttpError ? error.status : 503
    json(res, status, { error: error instanceof HttpError ? error.message : 'Server storage request failed. Check PostgreSQL, migrations, disk permissions, and server logs.' })
  }
})
const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/api/listen?') || !allowedOrigin(req.headers.origin, req.headers.host)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    return
  }
  wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req))
})
wss.on('connection', (client, req) => {
  const fail = (message) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'Error', description: message }))
      client.close(1011, 'Transcription unavailable')
    }
  }
  if (!configured) {
    fail('Add DEEPGRAM_API_KEY to .env and restart the server.')
    return
  }
  let url
  try {
    url = streamingUrl(new URL(req.url, 'http://localhost').searchParams)
  } catch (error) {
    fail(error.message)
    return
  }
  const upstream = new WebSocket(url, { headers: { Authorization: `Token ${key}` }, handshakeTimeout: 12000 })
  upstream.on('open', () => {
    if (client.readyState !== WebSocket.OPEN) { upstream.close(); return }
    client.send(JSON.stringify({ type: 'Ready' }))
  })
  upstream.on('message', (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
  })
  client.on('message', (data, binary) => {
    if (upstream.readyState !== WebSocket.OPEN) return
    if (upstream.bufferedAmount > 4 * 1024 * 1024) {
      fail('The connection is too slow. Recording has stopped; your captured audio will be saved.')
      upstream.close()
      return
    }
    if (binary) upstream.send(data, { binary: true })
    else {
      try {
        const message = JSON.parse(data.toString())
        if (['KeepAlive', 'CloseStream', 'Finalize'].includes(message.type)) upstream.send(JSON.stringify({ type: message.type }))
      } catch { fail('Invalid streaming control message.') }
    }
  })
  upstream.on('error', (error) => {
    console.error('Deepgram connection error:', error.message)
    fail('Deepgram could not connect. Check your API key, credits, model/language selection, and network.')
  })
  upstream.on('close', () => { if (client.readyState === WebSocket.OPEN) client.close(1000) })
  client.on('error', (error) => console.error('Browser connection error:', error.message))
  client.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close()
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate()
  })
})
server.listen(port, '127.0.0.1', () => console.log(`Fieldnote server ready at http://127.0.0.1:${port} (Deepgram ${configured ? 'configured' : 'not configured'})`))
