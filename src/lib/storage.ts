import type { Segment } from './transcript'

export interface Interview {
  id: string
  title: string
  project: string
  createdAt: string
  duration: number
  model: string
  language: string
  starred: boolean
  notes: string
  segments: Segment[]
  audio?: Blob
  audioUrl?: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(path, options) }
  catch { throw new Error('Cannot reach the storage server. Keep this page open and retry, or export a backup.') }
  if (!response.ok) {
    const result = await response.json() as { error?: string }
    throw new Error(result.error || `Storage request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export const loadInterviews = () => request<Interview[]>('/api/interviews')
export async function saveInterview(interview: Interview): Promise<Interview> {
  if (interview.audio) {
    const { audio, audioUrl: _url, ...metadata } = interview
    const form = new FormData()
    form.set('metadata', JSON.stringify(metadata))
    form.set('audio', audio, audio.type.includes('mp4') ? 'audio.mp4' : 'audio.webm')
    return request<Interview>('/api/interviews', { method: 'POST', body: form })
  }
  return request<Interview>(`/api/interviews/${interview.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: interview.title, project: interview.project, notes: interview.notes, starred: interview.starred }),
  })
}
export const deleteInterview = (id: string) => request<{ warning?: string }>(`/api/interviews/${id}`, { method: 'DELETE' })

export async function interviewAudio(interview: Interview): Promise<Blob> {
  if (interview.audio) return interview.audio
  if (!interview.audioUrl) throw new Error('No audio is available for this interview.')
  const response = await fetch(interview.audioUrl)
  if (!response.ok) throw new Error('Could not download audio. Check the server audio directory and try again.')
  return response.blob()
}

// Read-only access to the previous browser library. Import never deletes originals.
export async function loadBrowserInterviews(): Promise<Interview[]> {
  if (!(await indexedDB.databases()).some((database) => database.name === 'fieldnote')) return []
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fieldnote')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('interviews')) { db.close(); resolve([]); return }
      const tx = db.transaction('interviews', 'readonly')
      const read = tx.objectStore('interviews').getAll()
      tx.oncomplete = () => { db.close(); resolve(read.result as Interview[]) }
      tx.onerror = () => { db.close(); reject(tx.error || read.error) }
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Browser import was aborted.')) }
    }
  })
}
