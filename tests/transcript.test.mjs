import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseResult, formatTime, transcriptText } from '../src/lib/transcript.ts'

test('groups consecutive words by speaker and preserves punctuation', () => {
  const result = parseResult({ type: 'Results', is_final: true, channel: { alternatives: [{
    transcript: 'Hello there. Hi!', words: [
      { speaker: 0, start: 0, punctuated_word: 'Hello' },
      { speaker: 0, start: 0.4, punctuated_word: 'there.' },
      { speaker: 1, start: 1, punctuated_word: 'Hi!' },
    ],
  }] } })
  assert.deepEqual(result, { final: true, segments: [
    { speaker: 0, start: 0, text: 'Hello there.' }, { speaker: 1, start: 1, text: 'Hi!' },
  ] })
})
test('handles interim, empty, and non-result messages', () => {
  assert.equal(parseResult({ type: 'Metadata' }), null)
  assert.equal(parseResult(null), null)
  assert.deepEqual(parseResult({ type: 'Results' }), { final: false, segments: [] })
  assert.deepEqual(parseResult({ type: 'Results', start: 2, channel: { alternatives: [{ transcript: 'Testing' }] } }), {
    final: false, segments: [{ speaker: null, start: 2, text: 'Testing' }],
  })
})
test('formats durations and transcript exports', () => {
  assert.equal(formatTime(3601), '60:01')
  assert.equal(formatTime(-1), '00:00')
  assert.equal(transcriptText([{ speaker: 0, start: 61, text: 'Hello.' }]), '[01:01] Speaker 1: Hello.')
})
