import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamingUrl, allowedOrigin } from './config.mjs'

test('streaming defaults enable diarization and interim results without raw encoding', () => {
  const url = streamingUrl(new URLSearchParams())
  assert.equal(url.protocol, 'wss:')
  assert.equal(url.searchParams.get('model'), 'nova-3')
  assert.equal(url.searchParams.get('diarize'), 'true')
  assert.equal(url.searchParams.get('interim_results'), 'true')
  assert.equal(url.searchParams.has('encoding'), false)
})
test('validates model and language rather than forwarding arbitrary options', () => {
  assert.throws(() => streamingUrl(new URLSearchParams('model=invalid')))
  assert.throws(() => streamingUrl(new URLSearchParams('language=invalid')))
  assert.equal(streamingUrl(new URLSearchParams('model=nova-2&language=es')).searchParams.get('language'), 'es')
})
test('only accepts same-origin websocket requests', () => {
  assert.equal(allowedOrigin('http://127.0.0.1:9999', '127.0.0.1:9999'), true)
  assert.equal(allowedOrigin('https://evil.example', '127.0.0.1:9999'), false)
  assert.equal(allowedOrigin(undefined, '127.0.0.1:9999'), false)
})
