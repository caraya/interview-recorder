import { parseResult } from './transcript'
import type { Segment } from './transcript'

export type RecordingState = 'idle' | 'connecting' | 'recording' | 'paused' | 'saving'
interface Callbacks {
  state: (state: RecordingState) => void
  transcript: (segments: Segment[], interim: Segment[]) => void
  meter: (level: number, duration: number) => void
  error: (message: string) => void
  complete: (audio: Blob, segments: Segment[], duration: number) => Promise<void>
}

export class InterviewRecorder {
  private socket?: WebSocket
  private recorder?: MediaRecorder
  private stream?: MediaStream
  private context?: AudioContext
  private timer?: ReturnType<typeof setInterval>
  private keepAlive?: ReturnType<typeof setInterval>
  private segments: Segment[] = []
  private chunks: Blob[] = []
  private startedAt = 0
  private elapsed = 0
  private stopping = false
  private paused = false
  private ready = false
  private disposed = false
  private callbacks: Callbacks

  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks
  }

  async start(model: string, language: string) {
    this.callbacks.state('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('Recording needs a supported browser on localhost or HTTPS. Try the latest Chrome, Edge, or Safari.')
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (this.disposed) { this.cleanup(); return }
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('This browser does not support a compatible audio format.')
      this.recorder = new MediaRecorder(this.stream, { mimeType })
      this.context = new AudioContext()
      await this.context.resume()
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 256
      this.context.createMediaStreamSource(this.stream).connect(analyser)
      const samples = new Uint8Array(analyser.frequencyBinCount)
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/listen?${new URLSearchParams({ model, language })}`)
      this.socket = socket
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Deepgram connection timed out. Check your network and API configuration.')), 18000)
        const fail = (error: Error) => { clearTimeout(timeout); reject(error) }
        socket.onerror = () => {
          if (!this.ready) fail(new Error('Cannot reach the transcription server. Make sure npm run dev is running.'))
          else this.fail('The transcription connection failed. Your captured audio will be saved.')
        }
        socket.onclose = () => {
          if (!this.ready) fail(new Error('Deepgram disconnected before recording could start. Check the server configuration.'))
          else if (!this.stopping) this.fail('The transcription connection closed unexpectedly. Your captured audio will be saved.')
        }
        socket.onmessage = (event) => {
          let message: unknown
          try { message = JSON.parse(event.data) }
          catch {
            if (!this.ready) fail(new Error('The transcription server returned an invalid response.'))
            else this.fail('The transcription server returned an invalid response.')
            return
          }
          if (typeof message === 'object' && message && 'type' in message) {
            if (message.type === 'Ready') {
              clearTimeout(timeout)
              this.ready = true
              resolve()
            } else if (message.type === 'Error') {
              const description = 'description' in message && typeof message.description === 'string' ? message.description : 'Deepgram returned an error.'
              if (!this.ready) fail(new Error(description))
              else this.fail(description)
            }
          }
          const result = parseResult(message)
          if (result) {
            if (result.final) this.segments.push(...result.segments)
            this.callbacks.transcript([...this.segments], result.final ? [] : result.segments)
          }
        }
      })
      if (this.disposed) { this.cleanup(); return }
      this.recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        this.chunks.push(event.data)
        if (socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > 4 * 1024 * 1024) {
            this.fail('Your connection cannot keep up with the audio. The recording will be saved.')
            return
          }
          socket.send(event.data)
        }
      }
      this.recorder.onerror = () => this.fail('Microphone recording failed. Any captured audio will be saved.')
      this.stream.getAudioTracks().forEach((track) => {
        track.onended = () => { if (!this.stopping) this.fail('The microphone was disconnected. Your recording will be saved.') }
      })
      this.recorder.start(250)
      this.startedAt = performance.now()
      this.timer = setInterval(() => {
        analyser.getByteFrequencyData(samples)
        const level = samples.reduce((sum, value) => sum + value, 0) / samples.length / 128
        this.callbacks.meter(this.paused ? 0 : Math.min(1, level), this.duration())
      }, 100)
      this.keepAlive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }))
      }, 3000)
      this.callbacks.state('recording')
    } catch (error) {
      this.cleanup()
      if (!this.disposed) {
        this.callbacks.error(error instanceof Error ? error.message : 'Could not start recording.')
        this.callbacks.state('idle')
      }
    }
  }

  private duration() {
    return this.elapsed + (this.paused || !this.startedAt ? 0 : (performance.now() - this.startedAt) / 1000)
  }

  togglePause() {
    if (!this.recorder || this.stopping) return
    if (this.paused) {
      this.recorder.resume()
      this.startedAt = performance.now()
    } else {
      this.elapsed = this.duration()
      this.recorder.pause()
    }
    this.paused = !this.paused
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.paused })
    this.callbacks.state(this.paused ? 'paused' : 'recording')
  }

  private fail(message: string) {
    if (this.stopping || this.disposed) return
    this.callbacks.error(message)
    void this.stop()
  }

  async stop() {
    if (this.stopping || !this.recorder) return
    this.stopping = true
    const duration = this.duration()
    this.callbacks.state('saving')
    clearInterval(this.timer)
    clearInterval(this.keepAlive)
    if (this.recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.recorder!.onstop = () => resolve()
        this.recorder!.stop()
      })
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    const socket = this.socket
    if (socket?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.callbacks.error('Deepgram took too long to finalize. Audio is saved, but the transcript may be incomplete.')
          resolve()
        }, 7000)
        socket.addEventListener('close', () => { clearTimeout(timeout); resolve() }, { once: true })
        socket.send(JSON.stringify({ type: 'CloseStream' }))
      })
    }
    const blob = new Blob(this.chunks, { type: this.recorder.mimeType })
    this.cleanup()
    await this.callbacks.complete(blob, this.segments, duration)
    this.callbacks.state('idle')
  }

  private cleanup() {
    clearInterval(this.timer)
    clearInterval(this.keepAlive)
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close()
    if (this.context && this.context.state !== 'closed') void this.context.close()
  }

  dispose() {
    this.disposed = true
    this.stopping = true
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.cleanup()
  }
}
