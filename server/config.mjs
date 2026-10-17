export function streamingUrl(params) {
  const model = params.get('model') || 'nova-3'
  const language = params.get('language') || 'en'
  if (!['nova-3', 'nova-2'].includes(model)) throw new Error('Unsupported transcription model.')
  if (!['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'multi'].includes(language)) {
    throw new Error('Unsupported transcription language.')
  }
  const url = new URL('wss://api.deepgram.com/v1/listen')
  url.search = new URLSearchParams({
    model, language, smart_format: 'true', diarize: 'true',
    interim_results: 'true', endpointing: '300',
  }).toString()
  return url
}

export function allowedOrigin(origin, host) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && url.host === host
  } catch {
    return false
  }
}
