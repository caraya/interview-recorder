import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowRight, AudioLines, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, FileAudio, FileText, Folder, Headphones, LockKeyhole,
  Mic, MoreHorizontal, Pause, Play, Plus, Radio, Search, Settings2,
  ShieldCheck, Sparkles, Square, Star, Trash2, Users, X,
} from 'lucide-react'
import { deleteInterview, loadInterviews, saveInterview, interviewAudio, loadBrowserInterviews } from './lib/storage'
import type { Interview } from './lib/storage'
import { formatTime, transcriptText } from './lib/transcript'
import type { Segment } from './lib/transcript'
import { InterviewRecorder } from './lib/recorder'
import type { RecordingState } from './lib/recorder'
import './App.css'

const languages = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['multi', 'Multilingual'],
]
const waveform = Array.from({ length: 79 }, (_, i) => 8 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * .37)) * 58)

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement
    dialog.showModal()
    return () => { dialog.close(); if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></div>
    {children}
  </dialog>
}

function Transcript({ segments, interim = [] }: { segments: Segment[]; interim?: Segment[] }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { if (interim.length) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [interim])
  return <div className="transcript">
    {!segments.length && !interim.length ? <div className="transcript-empty"><AudioLines size={27} /><p>Your conversation will appear here.</p><span>Start speaking. We’ll take it from here.</span></div> :
      [...segments, ...interim].map((segment, index) => <div className={`transcript-line ${index >= segments.length ? 'interim' : ''}`} key={`${segment.start}-${index}`}>
        <span className={`speaker-avatar speaker-${(segment.speaker || 0) % 3}`}>{segment.speaker === null ? '?' : segment.speaker + 1}</span>
        <div><div className="speaker-label">{segment.speaker === null ? 'Speaker' : `Speaker ${segment.speaker + 1}`}<time>{formatTime(segment.start)}</time></div><p>{segment.text}</p></div>
      </div>)}
    <div ref={end} />
  </div>
}

function download(content: Blob, name: string) {
  const url = URL.createObjectURL(content)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function InterviewDetail({ interview, onClose, onUpdate, onDelete }: {
  interview: Interview; onClose: () => void
  onUpdate: (interview: Interview) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}) {
  const [notes, setNotes] = useState(interview.notes)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [exportError, setExportError] = useState('')
  const [tab, setTab] = useState<'transcript' | 'notes'>('transcript')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const url = interview.audio ? URL.createObjectURL(interview.audio) : interview.audioUrl
    if (audioRef.current) audioRef.current.src = url || ''
    return () => { if (interview.audio && url) URL.revokeObjectURL(url) }
  }, [interview.audio, interview.audioUrl])
  const filename = interview.title.replace(/[^a-z0-9_-]/gi, '-')
  return <Modal title={interview.title} onClose={onClose} wide>
    <div className="detail-meta"><span><Clock3 size={14} />{formatTime(interview.duration)}</span><span><Folder size={14} />{interview.project || 'Unfiled'}</span><span className="tag">{interview.model}</span></div>
    <audio ref={audioRef} controls preload="metadata" className="audio-player" aria-label="Interview recording" onError={() => setExportError('Audio playback failed. Check that the recording exists on the server.')} />
    {exportError && <div className="alert error" role="alert">{exportError}</div>}
    <div className="detail-tabs"><button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>Transcript <span>{interview.segments.length}</span></button><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>My notes</button></div>
    {tab === 'transcript' ? <Transcript segments={interview.segments} /> : <div className="notes-panel"><label htmlFor="saved-notes">Your interview notes</label><textarea id="saved-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What stood out? Add observations, follow-ups, and key moments." rows={9} /><button className="button primary small" disabled={saving || notes === interview.notes} onClick={async () => { setSaving(true); await onUpdate({ ...interview, notes }); setSaving(false) }}>{saving ? 'Saving…' : 'Save notes'}</button></div>}
    <div className="export-bar"><span>Keep a copy</span><button className="button secondary small" onClick={() => download(new Blob([`${interview.title}\n${interview.createdAt}\n\n${transcriptText(interview.segments)}\n\nNotes\n${notes}`], { type: 'text/plain' }), `${filename}.txt`)}><FileText size={15} />Transcript</button><button className="button secondary small" onClick={async () => { try { const audio = await interviewAudio(interview); download(audio, `${filename}.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`) } catch (error) { setExportError(error instanceof Error ? error.message : 'Audio download failed.') } }}><ArrowDownToLine size={15} />Audio</button><button className="button secondary small" onClick={() => { const { audio: _audio, ...data } = interview; download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${filename}.json`) }}>JSON</button></div>
    <div className="modal-footer">{confirmDelete ? <><span className="delete-warning">Delete this interview and audio permanently?</span><button className="button secondary small" onClick={() => setConfirmDelete(false)}>Keep interview</button><button className="button danger small" onClick={() => void onDelete(interview.id)}>Delete interview</button></> : <><button className="text-button muted" onClick={() => setConfirmDelete(true)}><Trash2 size={15} />Delete interview</button><button className="button secondary small" onClick={onClose}>Close</button></>}</div>
  </Modal>
}

function App() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [loaded, setLoaded] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [connectionError, setConnectionError] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'all' | 'starred'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [model, setModel] = useState('nova-3')
  const [language, setLanguage] = useState('en')
  const [consent, setConsent] = useState(false)
  const [settings, setSettings] = useState(false)
  const [help, setHelp] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [state, setState] = useState<RecordingState>('idle')
  const [segments, setSegments] = useState<Segment[]>([])
  const [interim, setInterim] = useState<Segment[]>([])
  const [duration, setDuration] = useState(0)
  const [level, setLevel] = useState(0)
  const [notes, setNotes] = useState('')
  const [unsaved, setUnsaved] = useState<Interview | null>(null)
  const [storageStatus, setStorageStatus] = useState('Checking PostgreSQL…')
  const [importing, setImporting] = useState(false)
  const engine = useRef<InterviewRecorder | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])
  const busy = state !== 'idle'

  const checkConnection = () => fetch('/api/status')
    .then(async (response) => {
      if (!response.ok) throw new Error('The local server is unavailable.')
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || !('configured' in result) || typeof result.configured !== 'boolean') throw new Error('Unexpected server response.')
      setConfigured(result.configured)
      setConnectionError(false)
      if ('storage' in result && result.storage && typeof result.storage === 'object' && 'message' in result.storage && typeof result.storage.message === 'string') {
        setStorageStatus(result.storage.message)
      }
    })
    .catch(() => {
      setConfigured(false)
      setConnectionError(true)
      setStorageStatus('Storage server unavailable.')
    })
  useEffect(() => {
    void loadInterviews().then(setInterviews).catch((error: unknown) => setError(error instanceof Error ? error.message : 'Could not load interviews from PostgreSQL.')).finally(() => setLoaded(true))
    void checkConnection()
    return () => engine.current?.dispose()
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!busy && !unsaved) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy, unsaved])

  const persist = async (interview: Interview) => {
    try {
      const saved = await saveInterview(interview)
      setInterviews((items) => [...items.filter((item) => item.id !== saved.id), saved])
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save to PostgreSQL. Export your audio before leaving this page.')
      return false
    }
  }
  const start = async () => {
    if (busy || unsaved) return
    if (!configured) { setSettings(true); return }
    if (!consent) { setError('Confirm that everyone has agreed to being recorded before starting.'); return }
    setError('')
    setSegments([])
    setInterim([])
    setDuration(0)
    setNotes('')
    const interviewTitle = title.trim() || 'Untitled interview'
    const createdAt = new Date().toISOString()
    engine.current = new InterviewRecorder({
      state: setState,
      transcript: (final, partial) => { setSegments(final); setInterim(partial) },
      meter: (value, seconds) => { setLevel(value); setDuration(seconds) },
      error: setError,
      complete: async (audio, final, seconds) => {
        const interview: Interview = { id: crypto.randomUUID(), title: interviewTitle, project: project.trim(), createdAt, duration: seconds, model, language, starred: false, notes: notesRef.current, segments: final, audio }
        setInterim([])
        if (await persist(interview)) {
          setNotice('Interview saved. Every word, in one place.')
          setSelected(interview.id)
          setTitle('')
          setConsent(false)
        } else setUnsaved(interview)
      },
    })
    await engine.current.start(model, language)
  }
  const remove = async (id: string) => {
    try {
      const result = await deleteInterview(id)
      setInterviews((items) => items.filter((item) => item.id !== id))
      setSelected(null)
      setNotice('Interview deleted.')
      if (result.warning) setError(result.warning)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not delete this interview. Check server logs and try again.') }
  }
  const importBrowser = async () => {
    setImporting(true)
    try {
      const legacy = await loadBrowserInterviews()
      let count = 0
      for (const interview of legacy) {
        await saveInterview(interview)
        count++
      }
      setInterviews(await loadInterviews())
      setNotice(count ? `Imported ${count} browser interviews. Existing server copies were preserved.` : 'No browser interviews found at this origin.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Import failed. Originals are still in browser storage; retry safely.')
      setSettings(false)
    } finally { setImporting(false) }
  }
  const newInterview = () => {
    setView('all')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    titleInput.current?.focus()
  }
  const filtered = interviews.filter((item) => (view === 'all' || item.starred) && `${item.title} ${item.project} ${transcriptText(item.segments)} ${item.notes}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.title.localeCompare(b.title))
  const totalDuration = interviews.reduce((total, item) => total + item.duration, 0)
  const activeInterview = interviews.find((item) => item.id === selected)
  const speakerCount = new Set(segments.map((segment) => segment.speaker).filter((speaker) => speaker !== null)).size

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <a href="#" className="brand" onClick={(event) => { event.preventDefault(); setView('all') }} aria-label="Fieldnote home"><span className="brand-icon"><AudioLines size={24} strokeWidth={2.2} /></span>fieldnote<span className="brand-period">.</span></a>
      <div className="workspace"><span className="workspace-avatar">P</span><div>Personal workspace<span>Your space to listen</span></div><LockKeyhole size={14} /></div>
      <button className="button primary new-interview" onClick={newInterview}><Plus size={18} />New interview<span>↗</span></button>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace">
        <button className={`nav-item ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}><Headphones size={19} />All interviews<span className="nav-count">{interviews.length}</span></button>
        <button className={`nav-item ${view === 'starred' ? 'active' : ''}`} onClick={() => setView('starred')}><Star size={19} />Starred<span className="nav-count">{interviews.filter((item) => item.starred).length}</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="local-card"><span className="local-icon"><ShieldCheck size={20} /></span><h3>Your words, well kept.</h3><p>Transcripts in PostgreSQL.<br />Audio on your server disk.</p><button onClick={() => setHelp(true)}>About interview storage <ArrowRight size={13} /></button></div>
        <button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={18} />Settings</button>
        <button className="nav-item" onClick={() => setHelp(true)}><CircleHelp size={18} />How it works<ArrowRight size={14} /></button>
        <div className="sidebar-profile"><span className="profile-avatar">You</span><div>Personal workspace<span>Local-first, always.</span></div><span className="profile-dot" /></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div>Workspace<span>/</span><strong>{view === 'all' ? 'All interviews' : 'Starred interviews'}</strong></div><button className="connection-badge" onClick={() => setSettings(true)}><span className={`status-dot ${configured ? 'online' : ''}`} />{configured ? 'Deepgram connected' : configured === null ? 'Checking connection' : 'Connect Deepgram'}<ChevronDown size={13} /></button></header>
      <main id="main">
        <section className="page-heading"><div><div className="eyebrow"><span />LESS NOTE-TAKING. MORE LISTENING.</div><h1>{view === 'all' ? <>Good conversations.<br /><span>Great insights.</span></> : <>The ones worth<br /><span>coming back to.</span></>}</h1><p>Be present in the moment. We’ll remember the details.</p></div><div className="heading-note"><span className="hand-drawn-arrow">⤵</span><span>A little less typing,<br />a lot more connecting.</span></div></section>
        {error && <div className="alert error" role="alert"><CircleHelp size={18} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
        {unsaved && <div className="alert recovery"><FileAudio size={20} /><span>Your interview is still in memory. Save or export it before leaving.</span><button className="button secondary small" onClick={async () => { if (await persist(unsaved)) { setUnsaved(null); setNotice('Interview saved.'); setSelected(unsaved.id) } }}>Retry save</button><button className="button primary small" onClick={async () => { try { const base = unsaved.title.replace(/[^a-z0-9_-]/gi, '-'); const audio = await interviewAudio(unsaved); download(audio, `${base}.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`); download(new Blob([transcriptText(unsaved.segments) + '\n\n' + unsaved.notes], { type: 'text/plain' }), `${base}.txt`) } catch (error) { setError(error instanceof Error ? error.message : 'Backup export failed.') } }}>Export backup</button></div>}
        <div className="recording-grid">
          <section className={`recorder-card ${busy ? 'is-recording' : ''}`} aria-labelledby="recorder-heading">
            <div className="card-heading"><span className="section-icon"><Mic size={18} /></span><h2 id="recorder-heading">{busy ? 'In the conversation' : 'Your next conversation starts here'}</h2><button className="icon-button" onClick={() => setSettings(true)} aria-label="Recording settings" disabled={busy}><Settings2 size={18} /></button></div>
            <div className="recording-form"><label htmlFor="interview-title">Interview name</label><input ref={titleInput} id="interview-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy || Boolean(unsaved)} placeholder="e.g. Discovery chat with Alex" maxLength={160} /><div className="form-row"><div><label htmlFor="project">Project <span>optional</span></label><div className="input-icon"><Folder size={15} /><input id="project" value={project} onChange={(event) => setProject(event.target.value)} disabled={busy || Boolean(unsaved)} placeholder="Add a project" maxLength={80} /></div></div><div><label htmlFor="language">Language</label><select id="language" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div></div>
            <div className={`waveform-area ${state === 'recording' ? 'live' : ''}`}>
              <div className="waveform" aria-hidden="true">{waveform.map((height, index) => <span key={index} style={{ height: `${busy ? 5 + height * level * 1.7 : height * .48}px`, opacity: busy ? .35 + level * .65 : .3 + Math.abs(Math.sin(index)) * .5 }} />)}</div>
              <div className="recording-timer">{formatTime(duration)}<span>{state === 'recording' ? 'RECORDING LIVE' : state === 'paused' ? 'RECORDING PAUSED' : state === 'connecting' ? 'CONNECTING TO DEEPGRAM' : state === 'saving' ? 'FINALIZING YOUR INTERVIEW' : 'READY WHEN YOU ARE'}</span></div>
            </div>
            <div className="record-controls">{busy ? <><button className="button secondary" onClick={() => engine.current?.togglePause()} disabled={state === 'connecting' || state === 'saving'}>{state === 'paused' ? <Play size={17} /> : <Pause size={17} />}{state === 'paused' ? 'Resume' : 'Pause'}</button><button className="button primary" onClick={() => void engine.current?.stop()} disabled={state === 'connecting' || state === 'saving'}><Square size={15} fill="currentColor" />{state === 'saving' ? 'Saving interview…' : 'Finish & save'}</button></> : <button className="button primary record-button" onClick={() => void start()} disabled={Boolean(unsaved) || configured === null}><Mic size={18} />Start recording<ArrowRight size={17} /></button>}</div>
            {!busy && <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Everyone has agreed to being recorded.</label>}
            <div className="recorder-footer"><span><span className="tiny-dot" />{model === 'nova-3' ? 'Nova-3' : 'Nova-2'} transcription</span><span><Users size={13} />Speaker detection on</span><span><LockKeyhole size={12} />PostgreSQL storage</span></div>
          </section>
          <aside className="intro-card"><div className="intro-top"><span className="mini-badge"><Sparkles size={12} />MADE FOR MEANINGFUL CONVERSATIONS</span><div className="orbit-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><span className="orbit-spark spark-one">✦</span><span className="orbit-spark spark-two">+</span><div className="art-mic"><AudioLines size={38} strokeWidth={1.5} /></div><span className="orbit-dot" /></div><h2>Stay in the<br />conversation.</h2><p>Not in your notes.</p></div><div className="intro-features"><div><span><Radio size={17} /></span><div>Every word, captured.<p>Accurate transcripts, as you speak.</p></div></div><div><span><Users size={17} /></span><div>Every voice, recognized.<p>Know who said what, automatically.</p></div></div><div><span><ShieldCheck size={17} /></span><div>Your conversations, your storage.<p>PostgreSQL transcripts. Server-disk audio.</p></div></div></div><a href="https://developers.deepgram.com/docs/live-streaming-audio" target="_blank" rel="noreferrer" className="powered-by">POWERED BY <strong><span className="deepgram-mark">◩</span> deepgram</strong><ArrowRight size={14} /></a></aside>
        </div>
        {busy && <section className="live-workspace"><div className="live-transcript-card"><div className="card-heading"><AudioLines size={18} /><h2>Live transcript</h2><span className="tag">{speakerCount} {speakerCount === 1 ? 'speaker' : 'speakers'}</span><span className="live-label"><span className="status-dot online" />{state === 'paused' ? 'Paused' : 'Live'}</span></div><Transcript segments={segments} interim={interim} /></div><div className="live-notes"><label htmlFor="live-notes"><FileText size={17} />A thought worth keeping?</label><textarea id="live-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Jot down observations, follow-ups, or that one brilliant idea…" rows={7} /><span>Saved with your interview.</span></div></section>}
        <section className="library" aria-labelledby="library-heading"><div className="library-heading"><div><h2 id="library-heading">{view === 'starred' ? 'Starred interviews' : 'Your interviews'}<span>{view === 'starred' ? interviews.filter((item) => item.starred).length : interviews.length}</span></h2><p>A home for your conversations. And everything you learn from them.</p></div><div className="library-stats"><Clock3 size={15} /><strong>{totalDuration < 60 ? '0 min' : `${Math.floor(totalDuration / 60)} min`}</strong> recorded<span /> <FileText size={15} /><strong>{interviews.length}</strong> transcripts</div></div>
          <div className="library-toolbar"><div className="filter-tabs" aria-label="Filter interviews"><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All interviews</button><button className={view === 'starred' ? 'active' : ''} onClick={() => setView('starred')}><Star size={14} />Starred</button></div><div className="library-tools"><div className="search-field"><Search size={16} /><input aria-label="Search interviews" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search interviews…" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div><select aria-label="Sort interviews" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="name">Name A–Z</option></select></div></div>
          <div className="interview-table"><div className="table-header"><span>INTERVIEW NAME</span><span>DATE</span><span>DURATION</span><span>STATUS</span><span /></div>
            {!loaded ? <div className="empty-state"><div className="loading-line" /><p>Opening your interview library…</p></div> : !filtered.length ? <div className="empty-state"><div className="empty-illustration"><span className="empty-line line-one" /><span className="empty-line line-two" /><div><AudioLines size={29} strokeWidth={1.4} /></div><span className="empty-spark">+</span></div><h3>{query ? 'No conversations found' : view === 'starred' ? 'Keep the good ones close.' : 'Your first great conversation is waiting.'}</h3><p>{query ? 'Try a different name, project, or word from your transcript.' : view === 'starred' ? 'Star an interview to find it right here.' : 'Record an interview and turn the conversation into something you can come back to.'}</p><button className="text-button" onClick={query ? () => setQuery('') : newInterview}>{query ? 'Clear search' : 'Start a conversation'}<ArrowRight size={15} /></button></div> :
              filtered.map((interview) => <div className="interview-row" key={interview.id}><button className="interview-name" onClick={() => setSelected(interview.id)}><span className="file-icon"><AudioLines size={20} /></span><span><strong>{interview.title}</strong><small>{interview.project || 'No project'}</small></span></button><span className="interview-date">{new Date(interview.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="duration-cell">{formatTime(interview.duration)}</span><span className={`saved-status ${!interview.segments.length ? 'audio-only' : ''}`}><CheckCheck size={13} />{interview.segments.length ? 'Transcribed' : 'Audio only'}</span><div className="row-actions"><button className={`icon-button star-button ${interview.starred ? 'starred' : ''}`} aria-label={interview.starred ? `Unstar ${interview.title}` : `Star ${interview.title}`} aria-pressed={interview.starred} onClick={() => void persist({ ...interview, starred: !interview.starred })}><Star size={17} fill={interview.starred ? 'currentColor' : 'none'} /></button><button className="icon-button" aria-label={`Open ${interview.title}`} onClick={() => setSelected(interview.id)}><MoreHorizontal size={19} /></button></div></div>)}
          </div>
          <div className="library-footer"><span><LockKeyhole size={12} />Saved to your server. Back up PostgreSQL and the audio directory together.</span><span>Built for better listening <span className="footer-spark">✧</span></span></div>
        </section>
      </main>
      <footer className="page-footer"><span className="footer-brand"><AudioLines size={16} />fieldnote.</span><span>A little more human. A lot more present.</span><span>YOUR WORDS, WELL KEPT.</span></footer>
    </div>
    {notice && <div className="toast" role="status"><span><Check size={16} /></span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    {activeInterview && <InterviewDetail key={activeInterview.id} interview={activeInterview} onClose={() => setSelected(null)} onUpdate={persist} onDelete={remove} />}
    {settings && <Modal title="Recording settings" onClose={() => setSettings(false)}><div className="settings-content">
      <div className={`connection-panel ${configured ? 'connected' : ''}`}><span className={`status-dot ${configured ? 'online' : ''}`} /><strong>{configured ? 'Deepgram is configured' : connectionError ? 'Local server unavailable' : 'Connect your Deepgram account'}</strong><button className="text-button" onClick={() => void checkConnection()}>Recheck</button></div>
      <p>Keep your API key on the server, never in your browser. Set it in the project’s <code>.env</code> file:</p><pre>DEEPGRAM_API_KEY=your_deepgram_api_key</pre><p>Then restart <code>npm run dev</code>. <a href="https://console.deepgram.com/" target="_blank" rel="noreferrer">Get a Deepgram API key <ArrowRight size={13} /></a></p>
      <label htmlFor="model">Transcription model</label><select id="model" disabled={busy} value={model} onChange={(event) => setModel(event.target.value)}><option value="nova-3">Nova-3 — recommended</option><option value="nova-2">Nova-2</option></select><p className="field-hint">Nova-3 is the default for interviews. Language support and pricing differ by model; check Deepgram’s documentation before recording.</p>
      <h3>PostgreSQL storage</h3><p role="status">{storageStatus}</p><p>Set <code>DATABASE_URL</code> in <code>.env</code>, then run <code>npm run db:migrate</code>. Audio files are stored in <code>AUDIO_STORAGE_DIR</code> (default: <code>data/audio</code>).</p>
      <button className="button secondary small" disabled={busy || importing} onClick={() => void importBrowser()}>{importing ? 'Importing browser interviews…' : 'Import existing browser interviews'}</button><p className="field-hint">Import reads this browser’s previous library at the current origin. Originals are not deleted; existing server IDs are not overwritten. A partial import can safely be retried.</p>
      <button className="text-button" onClick={async () => { try { setInterviews(await loadInterviews()); await checkConnection(); setNotice('Interview library refreshed.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not refresh interviews.'); setSettings(false) } }}>Refresh server library <ArrowRight size={14} /></button>
      <div className="settings-callout"><ShieldCheck size={20} /><p>Audio is streamed to Deepgram for transcription. Transcripts and notes are saved in PostgreSQL; recordings are saved on the app server’s disk. Back up both.</p></div>
    </div><div className="modal-footer"><a className="text-button" href="https://developers.deepgram.com/docs/models-languages-overview" target="_blank" rel="noreferrer">Model & language guide <ArrowRight size={14} /></a><button className="button primary small" onClick={() => setSettings(false)}>Done</button></div></Modal>}
    {help && <Modal title="A little more present." onClose={() => setHelp(false)}><div className="help-content"><p className="help-intro">You bring the curiosity. Fieldnote keeps the conversation.</p><ol><li><span>01</span><div><h3>Make room for a conversation</h3><p>Configure PostgreSQL and Deepgram, name your interview, and get everyone’s permission to record.</p></div></li><li><span>02</span><div><h3>Listen. Really listen.</h3><p>Record your microphone while Deepgram transcribes live and identifies speakers. Headphones are recommended. Remote-call audio is not captured automatically.</p></div></li><li><span>03</span><div><h3>Come back to the good parts</h3><p>Finish to save your audio, transcript, and notes to the server. Search, star, listen back, or export your interview.</p></div></li></ol><div className="settings-callout"><LockKeyhole size={22} /><p><strong>Durable storage still needs a backup.</strong> PostgreSQL holds transcripts, segments, notes, and metadata. The server audio directory holds recordings. Back up and restore both together. Clearing browser data does not delete server interviews.</p></div><p className="field-hint">Speaker labels are automatic estimates, not verified identities. Transcription requires an internet connection and may incur Deepgram usage charges. Review Deepgram’s data handling policy for sensitive interviews.</p></div><div className="modal-footer"><button className="button primary small" onClick={() => setHelp(false)}>Sounds good <Check size={15} /></button></div></Modal>}
  </div>
}

export default App
