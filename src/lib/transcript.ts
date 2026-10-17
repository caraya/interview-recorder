export interface Segment {
  speaker: number | null
  start: number
  text: string
}

export function parseResult(input: unknown): { final: boolean; segments: Segment[] } | null {
  if (!input || typeof input !== 'object' || !('type' in input) || input.type !== 'Results') return null
  const message = input as { is_final?: boolean; start?: number; channel?: { alternatives?: { transcript?: string; words?: { speaker?: number; start?: number; word?: string; punctuated_word?: string }[] }[] } }
  const alternative = message.channel?.alternatives?.[0]
  if (!alternative?.transcript) return { final: Boolean(message.is_final), segments: [] }
  const segments: Segment[] = []
  for (const word of alternative.words || []) {
    const speaker = typeof word.speaker === 'number' ? word.speaker : null
    const text = word.punctuated_word || word.word || ''
    const last = segments.at(-1)
    if (last && last.speaker === speaker) last.text += ` ${text}`
    else segments.push({ speaker, start: word.start || 0, text })
  }
  if (!segments.length) segments.push({ speaker: null, start: message.start || 0, text: alternative.transcript })
  return { final: Boolean(message.is_final), segments }
}

export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`
}

export function transcriptText(segments: Segment[]) {
  return segments.map((segment) => `[${formatTime(segment.start)}] ${segment.speaker === null ? 'Speaker' : `Speaker ${segment.speaker + 1}`}: ${segment.text}`).join('\n\n')
}
